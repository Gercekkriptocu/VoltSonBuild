import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export const runtime = 'edge';

/**
 * Strip HTML tags from text
 */
function stripHtml(html: string): string {
  try {
    const $ = cheerio.load(html);
    $('script, style').remove();
    const text = $('body').text() || $.text();
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
  } catch {
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

/**
 * Translate using DeepL API
 */
async function translateWithDeepL(text: string): Promise<string | null> {
  const DEEPL_API_KEY = process.env.DEEPL_API_KEY || process.env.NEXT_PUBLIC_DEEPL_API_KEY;
  
  if (!DEEPL_API_KEY) {
    console.log('DeepL API key not found, will use fallback');
    return null;
  }

  try {
    const response = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        text: text,
        target_lang: 'TR',
        source_lang: 'EN',
      }),
    });

    if (!response.ok) {
      console.error('DeepL API error:', response.status, response.statusText);
      return null;
    }

    const data = await response.json();
    return data.translations?.[0]?.text || null;
  } catch (error) {
    console.error('DeepL translation error:', error);
    return null;
  }
}

/**
 * Translate using Google Translate (fallback)
 */
async function translateWithGoogle(text: string): Promise<string | null> {
  try {
    // Simple Google Translate API request
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=${encodeURIComponent(text)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      return null;
    }

    const translations: string[] = [];
    for (const item of data[0]) {
      if (Array.isArray(item) && item[0]) {
        translations.push(item[0]);
      }
    }
    
    return translations.join('');
  } catch (error) {
    console.error('Google Translate error:', error);
    return null;
  }
}

/**
 * Translate using OpenAI as fallback
 */
async function translateWithOpenAI(text: string): Promise<string> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  
  if (!OPENAI_API_KEY) {
    console.error('OpenAI API key not found in environment variables');
    throw new Error('OpenAI API key not configured');
  }

  try {
    console.log('🤖 OpenAI translation started for text:', text.substring(0, 100));
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Sen profesyonel bir İngilizce-Türkçe çevirmensin. Görevin kripto haber metinlerini Türkçeye çevirmek.

🎯 GÖREV: Sadece çeviriyi yaz. Hiçbir açıklama, giriş veya ek yorum yapma.

✅ KURALLAR:
1. Metni TAMAMEN Türkçeye çevir
2. Her kelimenin, her cümlenin Türkçe olması ZORUNLU
3. Orijinal İngilizce metni çeviriye ekleme
4. "İşte çeviri:" gibi giriş cümleleri yazma
5. Açıklama veya yorum ekleme

🔧 KRİPTO TERİMLER (DEĞİŞTİRME):
- Bitcoin, Ethereum, NFT, blockchain, DeFi, Web3, airdrop → AYNEN BIRAK
- Kişi isimleri (Michael Saylor, Elon Musk) → AYNEN BIRAK
- Şirket isimleri (Strategy Inc., Tesla, Apple) → AYNEN BIRAK
- Dolar ($835 million) → AYNEN BIRAK

📋 ÖRNEKLER:

İNGİLİZCE: "Michael Saylor doubled down on Bitcoin."
TÜRKÇE: "Michael Saylor Bitcoin'e olan inancını ikiye katladı."

İNGİLİZCE: "Strategy Inc. revealed it bought $835 million in Bitcoin."
TÜRKÇE: "Strategy Inc., 835 milyon dolar değerinde Bitcoin aldığını açıkladı."

İNGİLİZCE: "The company announced a new partnership."
TÜRKÇE: "Şirket yeni bir ortaklık duyurdu."

⚠️ ÇOK ÖNEMLİ:
- SADECE Türkçe çeviriyi yaz
- Orijinal İngilizce metni ekleme
- Giriş cümlesi veya açıklama yapma
- Her cümle Türkçe olmalı`,
          },
          {
            role: 'user',
            content: `Şu metni Türkçeye çevir (sadece çeviriyi yaz, başka hiçbir şey yazma):

${text}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error('OpenAI translation failed');
    }

    const data = await response.json();
    let translation = data.choices?.[0]?.message?.content || text;
    
    console.log('🤖 OpenAI raw response:', translation.substring(0, 200));
    
    // ULTRA STRICT: Remove ANY English content
    // Split by sentences (., !, ?)
    const sentences = translation.split(/(?<=[.!?])\s+/);
    const filteredSentences = sentences.filter((sentence: string) => {
      const trimmed = sentence.trim();
      if (!trimmed || trimmed.length < 5) return false;
      
      // Must have Turkish special characters
      const turkishChars = /[üğışöçÜĞİŞÖÇ]/;
      const hasTurkishChars = turkishChars.test(trimmed);
      
      // Aggressive English pattern detection
      const englishPatterns = [
        /\b(is|are|was|were|has|have|had|been|being|will|would|could|should|can|may|might)\s+[a-z]/i,
        /\b(the|this|that|these|those|an|a)\s+[a-z]/i,
        /\b(doubled down|revealed|pioneered|according to|announced|said|stated|reported)\b/i,
        /\b(company|firm|corporation|inc\.|announced|revealed|disclosed|reported)\b/i,
        /\b(for|from|with|about|during|since|until|before|after)\s+the\b/i,
        /\b[A-Z][a-z]+\s+(is|are|was|were|has|have|said|announced)\b/,
        /^[A-Z][a-z]+\s+[a-z]+ed\b/  // Matches "Company announced" patterns
      ];
      const hasEnglishPattern = englishPatterns.some(pattern => pattern.test(trimmed));
      
      // Check word structure - English words typically don't have Turkish chars
      const words = trimmed.split(/\s+/);
      const englishWordCount = words.filter(word => {
        const cleanWord = word.replace(/[.,!?;:]/g, '');
        return cleanWord.length > 2 && 
               !/[üğışöçÜĞİŞÖÇ]/.test(cleanWord) &&
               /^[a-zA-Z]+$/.test(cleanWord) &&
               !/^(Bitcoin|Ethereum|NFT|DeFi|DAO|Web3|Base|Solana|\$[0-9]|[A-Z][a-z]+\s*Inc|Michael|Saylor|Strategy)/.test(cleanWord);
      }).length;
      const englishWordPercentage = (englishWordCount / Math.max(words.length, 1)) * 100;
      
      // STRICT: Keep only if has Turkish chars AND no English patterns AND less than 30% English words
      return hasTurkishChars && !hasEnglishPattern && englishWordPercentage < 30;
    });
    
    translation = filteredSentences.join(' ').trim();
    
    console.log('🔍 Filtered translation:', translation.substring(0, 200));
    console.log('📊 Filtered sentences count:', filteredSentences.length, 'out of', sentences.length);
    
    // Validate that translation is actually Turkish
    const turkishChars = /[üğışöç]/i;
    const hasTurkishChars = turkishChars.test(translation);
    
    // Check if text contains common Turkish words
    const commonTurkishWords = ['bir', 'için', 'ile', 've', 'bu', 'olan', 'olarak', 'göre', 'daha', 'kadar', 'yaparak', 'sonra', 'sırasında'];
    const words = translation.toLowerCase().split(/\s+/);
    const turkishWordCount = words.filter(word => {
      return turkishChars.test(word) || commonTurkishWords.includes(word);
    }).length;
    const turkishWordPercentage = (turkishWordCount / Math.max(words.length, 1)) * 100;
    
    console.log('✅ Turkish validation:', {
      hasTurkishChars,
      turkishWordPercentage: turkishWordPercentage.toFixed(1) + '%',
      length: translation.length
    });
    
    // Only accept translation if it has Turkish characteristics
    if (!hasTurkishChars || turkishWordPercentage < 20 || translation.length < 20) {
      console.warn('❌ Translation validation failed - falling back to Google Translate');
      throw new Error('Translation validation failed');
    }
    
    // Clean up any remaining HTML
    return stripHtml(translation);
  } catch (error) {
    console.error('OpenAI translation error:', error);
    throw error;
  }
}

/**
 * Main translation endpoint
 */
export async function POST(request: Request) {
  try {
    const { text } = await request.json();

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Invalid text provided' },
        { status: 400 }
      );
    }

    // Strip HTML first
    const cleanText = stripHtml(text);

    if (cleanText.trim().length === 0) {
      return NextResponse.json(
        { translation: text },
        { status: 200 }
      );
    }

    // Try DeepL first (better quality for Turkish)
    let translation = await translateWithDeepL(cleanText);

    // Fallback to OpenAI if DeepL fails
    if (!translation) {
      console.log('Using OpenAI fallback for translation');
      try {
        translation = await translateWithOpenAI(cleanText);
      } catch (openaiError) {
        console.warn('OpenAI failed, trying Google Translate:', openaiError);
        // Last resort: Google Translate
        translation = await translateWithGoogle(cleanText);
        if (!translation) {
          throw new Error('All translation services failed');
        }
      }
    }

    // Final cleanup
    const finalTranslation = stripHtml(translation);

    return NextResponse.json(
      { translation: finalTranslation },
      { status: 200 }
    );
  } catch (error) {
    console.error('Translation endpoint error:', error);
    return NextResponse.json(
      { 
        error: 'Translation failed',
        translation: stripHtml((await request.json()).text) // Return cleaned original text
      },
      { status: 500 }
    );
  }
}
