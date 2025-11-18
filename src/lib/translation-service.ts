/**
 * Translation Service - Multi-provider translation with fallbacks
 */

import { openaiChatCompletion } from '../openai-api';
import * as cheerio from 'cheerio';

/**
 * Translate using Google Translate (unofficial, free, high quality)
 * This uses Google's web translation service, not the official API
 */
async function translateWithGoogle(text: string, targetLang: 'tr' | 'en'): Promise<string> {
  try {
    const sourceLang = targetLang === 'tr' ? 'en' : 'tr';
    
    // Use translate.googleapis.com (unofficial endpoint)
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol: 'https',
        origin: 'translate.googleapis.com',
        path: `/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      })
    });

    if (!response.ok) {
      console.error(`❌ Google Translate API error: ${response.status}`);
      throw new Error(`Google Translate API error: ${response.status}`);
    }

    const data = await response.json() as unknown[][];
    
    // Parse Google Translate response format: [[["translated text", "original", null, null, 3]]]
    if (!data || !Array.isArray(data) || data.length === 0) {
      throw new Error('Invalid Google Translate response');
    }

    const translations: string[] = [];
    for (const item of data[0] as unknown[]) {
      if (Array.isArray(item) && item[0]) {
        translations.push(item[0] as string);
      }
    }
    
    const translation = translations.join('');
    
    if (!translation || translation.trim().length === 0) {
      throw new Error('Empty translation result');
    }

    console.log('✅ Google Translate successful');
    return translation;
  } catch (error) {
    console.error('❌ Google Translate error:', error instanceof Error ? error.message : error);
    throw error;
  }
}

/**
 * Translate using LibreTranslate (free, self-hosted instances available)
 */
async function translateWithLibreTranslate(text: string, targetLang: 'tr' | 'en'): Promise<string> {
  try {
    // Use official LibreTranslate instance
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol: 'https',
        origin: 'translate.argosopentech.com',
        path: '/translate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          q: text,
          source: targetLang === 'tr' ? 'en' : 'tr',
          target: targetLang,
          format: 'text'
        }
      })
    });

    if (!response.ok) {
      console.error(`❌ LibreTranslate API error: ${response.status}`);
      throw new Error(`LibreTranslate API error: ${response.status}`);
    }

    const data = await response.json() as { translatedText?: string };
    
    if (!data.translatedText || data.translatedText.trim().length === 0) {
      throw new Error('Empty translation result');
    }

    console.log('✅ LibreTranslate translation successful');
    return data.translatedText;
  } catch (error) {
    console.error('❌ LibreTranslate error:', error instanceof Error ? error.message : error);
    throw error;
  }
}

/**
 * Strip HTML tags from text and clean up mixed content
 */
function stripHtml(html: string): string {
  try {
    // Load HTML with cheerio
    const $ = cheerio.load(html);
    
    // Remove script and style tags
    $('script, style').remove();
    
    // Get text content only
    let text = $('body').text() || $.text();
    
    // Remove pipe character and everything after it (often mixed content)
    text = text.split('|')[0] || text;
    
    // Remove URLs
    text = text.replace(/https?:\/\/[^\s]+/g, '');
    text = text.replace(/www\.[^\s]+/g, '');
    text = text.replace(/t\.co\/[^\s]+/g, '');
    
    // Remove URL parameters and source mentions
    text = text.replace(/source=(twitter|web|facebook|instagram|reddit|telegram)[^\s]*/gi, '');
    text = text.replace(/utm_[a-z_]+=\[^\s&]*/gi, '');
    text = text.replace(/ref=[^\s&]*/gi, '');
    text = text.replace(/\?[a-z_]+=\w+(&[a-z_]+=\w+)*/gi, '');
    
    // Remove common artifacts and patterns
    text = text.replace(/RSVP:/gi, '');
    text = text.replace(/Read more:/gi, '');
    text = text.replace(/Click here:/gi, '');
    text = text.replace(/\[…\]/g, '');
    text = text.replace(/\[\.\.\.]/g, '');
    
    // Clean up whitespace
    text = text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
    
    // If text is too short after cleaning, return empty
    if (text.length < 10) {
      return '';
    }
    
    return text;
  } catch {
    // If cheerio fails, just remove basic HTML tags
    let text = html
      .replace(/<[^>]*>/g, ' ')
      .split('|')[0] || html
      .replace(/https?:\/\/[^\s]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    return text;
  }
}

/**
 * Translate text to a target language
 */
export async function translateText(text: string, targetLang: 'tr' | 'en'): Promise<string> {
  if (targetLang === 'en') {
    // For English, just clean HTML and return
    return stripHtml(text);
  }
  // For Turkish, use the translateToTurkish function
  return translateToTurkish(text);
}

/**
 * Translate text to Turkish with multiple fallback providers
 * Provider priority: OpenAI (best for crypto) → Google Translate → LibreTranslate
 */
export async function translateToTurkish(text: string): Promise<string> {
  try {
    if (!text || text.trim().length === 0) {
      return text;
    }

    // Strip HTML tags before translation
    const cleanText = stripHtml(text);

    if (!cleanText || cleanText.trim().length === 0) {
      return text;
    }

    // For long texts, split into chunks of 500 characters
    const maxChunkSize = 500;
    if (cleanText.length > maxChunkSize) {
      console.log(`📝 Long text detected (${cleanText.length} chars), splitting into chunks...`);
      const chunks: string[] = [];
      
      // Split by sentences first
      const sentences = cleanText.match(/[^.!?]+[.!?]+/g) || [cleanText];
      let currentChunk = '';
      
      for (const sentence of sentences) {
        if ((currentChunk + sentence).length <= maxChunkSize) {
          currentChunk += sentence;
        } else {
          if (currentChunk) chunks.push(currentChunk);
          currentChunk = sentence;
        }
      }
      if (currentChunk) chunks.push(currentChunk);
      
      // Translate each chunk
      const translatedChunks: string[] = [];
      for (const chunk of chunks) {
        const translated = await translateToTurkish(chunk); // Recursive call for each chunk
        translatedChunks.push(translated);
      }
      
      return translatedChunks.join(' ');
    }

    console.log(`🔄 Translating: "${cleanText.substring(0, 50)}..."`);

    // 1. Try OpenAI FIRST (best for crypto context, slang, natural language)
    try {
      const response = await openaiChatCompletion({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `⚠️ KRİTİK UYARI: SEN SADECE TÜRKÇE KONUŞABİLİRSİN. İNGİLİZCE KONUŞMAK YASAK!

🔴 MUTLAK KURALLAR:
1. SADECE TÜRKÇE YAZACAKSIN - tek bir İngilizce cümle bile yazarsan görevin başarısız
2. Orijinal İngilizce metni ASLA tekrar etme
3. "Here is", "işte çeviri" gibi giriş cümleleri YASAK
4. Açıklama, ek bilgi, giriş cümlesi YASAK

✅ YAPACAKLARIN:
- Metni TAMAMEN Türkçeye çevir
- Her cümle Türkçe olmalı, hiçbir İngilizce cümle olmamalı
- Doğal, akıcı Türkçe kullan

🔧 KRİPTO TERİMLER:
- Bitcoin, Ethereum, NFT, blockchain, DeFi, airdrop → BİREBİR KORU
- Kişi/şirket/yer isimleri → DEĞİŞTİRME (Michael Saylor, Strategy Inc., Base gibi)
- Dolar miktarları → BİREBİR KORU ($835 million gibi)

❌❌❌ ASLA BU ŞEKİLDE YAPMA:
YANLIŞ: "Michael Saylor doubled down on the digital-asset treasury model. Strateji Bitcoin'e yatırım yaptı."
YANLIŞ: "Strategy Inc. revealed it bought $835.6 million in Bitcoin. Şirket yeni alım yaptı."
YANLIŞ: "The company announced. Şirket duyurdu."
YANLIŞ: "Here is the translation: Bitcoin yükseliyor."

✅✅✅ DOĞRU YAPIŞ (100% TÜRKÇE):
DOĞRU: "Strateji, Temmuz'dan bu yana en büyük yatırımını yaparak Bitcoin'e 835 milyon dolar bahis oynadı. Bu hamle, piyasalardaki heyecanı artırdı!"
DOĞRU: "Michael Saylor, geçen haftaki kripto piyasası çalkantısı sırasında öncülük ettiği dijital varlık hazine modelini ikiye katladı. Strategy Inc., Pazar günü sona eren yedi günde 835,6 milyon dolar değerinde Bitcoin aldığını açıkladı."
DOĞRU: "Bitcoin fiyatı rekor seviyeye ulaştı. Yatırımcılar heyecanlı!"

🎯 HATIRLA: Eğer ÇEVİRİN İÇİNDE TEK BİR İNGİLİZCE CÜMLE bile varsa, görevin BAŞARISIZ!

ŞİMDİ ÇEVİR (100% TÜRKÇE - HİÇBİR İNGİLİZCE CÜMLE YOK):`
          },
          {
            role: 'user',
            content: cleanText
          }
        ],
        temperature: 0.3, // Lower temperature for more consistent translations
        max_tokens: 500
      });

      let translation = response.choices[0]?.message?.content || '';
      
      // ULTRA STRICT: Remove ANY English content
      const sentences = translation.split(/(?<=[.!?])\s+/);
      const filteredSentences = sentences.filter((sentence) => {
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
          /^[A-Z][a-z]+\s+[a-z]+ed\b/
        ];
        const hasEnglishPattern = englishPatterns.some(pattern => pattern.test(trimmed));
        
        // Check word structure
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
      
      // Strict validation - must have Turkish characters
      const hasTurkishChars = /[üğışöçÜĞİŞÖÇ]/.test(translation);
      const isLongEnough = translation.length > 20;
      
      if (translation && hasTurkishChars && isLongEnough) {
        console.log('✅ Using OpenAI translation (crypto-optimized)');
        return stripHtml(translation);
      } else {
        console.warn('⚠️ OpenAI translation failed validation:', {
          hasTurkishChars,
          isLongEnough,
          length: translation.length
        });
        throw new Error('OpenAI translation validation failed');
      }
    } catch (openaiError) {
      console.warn('⚠️ OpenAI failed, trying Google Translate:', openaiError instanceof Error ? openaiError.message : openaiError);
    }

    // 2. Try Google Translate as fallback
    try {
      const googleTranslation = await translateWithGoogle(cleanText, 'tr');
      
      // Verify translation quality
      if (googleTranslation && 
          googleTranslation.toLowerCase() !== cleanText.toLowerCase() && 
          googleTranslation.length > 10) {
        console.log('✅ Using Google Translate');
        return googleTranslation;
      }
    } catch (googleError) {
      console.warn('⚠️ Google Translate failed, trying LibreTranslate');
    }

    // 3. Try LibreTranslate as last resort
    try {
      const libreTranslation = await translateWithLibreTranslate(cleanText, 'tr');
      
      // Verify translation quality
      if (libreTranslation && 
          libreTranslation.toLowerCase() !== cleanText.toLowerCase() && 
          libreTranslation.length > 10) {
        console.log('✅ Using LibreTranslate translation');
        return libreTranslation;
      }
    } catch (libreError) {
      console.warn('⚠️ All translation services failed');
    }

    // If all translations fail, return cleaned original text
    console.warn('⚠️ All translation services failed, returning original');
    return cleanText;
  } catch (error) {
    console.error('❌ Translation error:', error instanceof Error ? error.message : error);
    return stripHtml(text);
  }
}

/**
 * Translate multiple texts in batch
 */
export async function translateBatch(texts: string[]): Promise<string[]> {
  try {
    const translations = await Promise.all(
      texts.map(text => translateToTurkish(text))
    );
    return translations;
  } catch (error) {
    console.error('Batch translation error:', error);
    return texts;
  }
}

export interface SummaryWithSentiment {
  summary: string;
  sentiment: 'positive' | 'negative' | 'neutral';
}

/**
 * Retry function with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * Summarize, translate news to Turkish, and analyze sentiment
 * Creates a concise summary, translates it, and determines if news is positive/negative
 * Includes retry mechanism for better reliability
 */
export async function summarizeAndTranslate(title: string, text?: string): Promise<SummaryWithSentiment> {
  try {
    // Truncate content if too long (max 2000 chars)
    let content = text ? `${title}\n\n${text}` : title;
    if (content.length > 2000) {
      content = content.substring(0, 2000) + '...';
    }
    
    if (!content || content.trim().length === 0) {
      return { summary: title, sentiment: 'neutral' };
    }

    console.log(`📝 Summarizing: "${title.substring(0, 50)}..."`);

    // Use retry mechanism for API calls
    const result = await retryWithBackoff(async () => {
      const response = await openaiChatCompletion({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Sen kripto haber analiz uzmanısın. Doğal, heyecan verici, ve okunabilir Türkçe özetler yazıyorsun.

GÖREV: Haberi özetle ve JSON döndür:
{
  "summary": "Kısa Türkçe özet (2-3 cümle, doğal ve akıcı)",
  "sentiment": "positive veya negative veya neutral"
}

ÇOK ÖNEMLİ KURALLAR:
✅ SADECE Türkçe özet - robot gibi değil, doğal konuş
✅ Gereksiz jenerik cümleler ekleme ("Detaylar için gelişmeleri takip edin" gibi)
✅ Haberin heyecanını ve tonunu koru
✅ Orijinal İngilizce metni dahil etme
✅ 100% Türkçe özet - hiçbir İngilizce cümle yok

KRİPTO SLANG & TERİMLER:
- IYKYK → "Bilenler bilir" veya "merak edenler için sürpriz var"
- LFG → "Hadi bakalım!" / "Başlıyoruz!"
- WAGMI → "Hepimiz başaracağız"
- GM/GN → "Günaydın"/"İyi geceler"
- NGMI → "Başarısız olacak"
- "to the moon" → "fırlamak", "zirveye çıkmak"
- "pump/dump" → "yükseliş/düşüş"
- Airdrop, NFT, DeFi, DAO, blockchain, Bitcoin, Ethereum → olduğu gibi bırak
- Kişi/şirket isimleri → değiştirme

ÖRNEKLER:
❌ Kötü: "Across, yeni bir ürünün çok yakında Across mağazasında satışa sunulacağını duyurdu. Detaylar için gelişmeleri takip etmek önemli."
✅ İyi: "Across shop'a yeni bir ürün geliyor. Bilenler bilir 👀"

❌ Kötü: "Bitcoin fiyatı artış göstermiştir ve piyasa pozitif seyretmektedir."
✅ İyi: "Bitcoin fırlıyor! Piyasa yeşilde, yükseliş devam ediyor."

SENTIMENT:
- positive: Fiyat artışları, iyi haberler, büyüme, başarılar
- negative: Düşüşler, hack'ler, yasal sorunlar, kötü haberler
- neutral: Objektif bilgiler, analizler, nötr duyurular

SADECE JSON döndür.`
          },
          {
            role: 'user',
            content: content
          }
        ],
        temperature: 0.5, // Slightly more creative for natural language
        max_tokens: 500
      });

      return response.choices[0]?.message?.content || '';
    }, 2, 1500); // Reduced retries to 2 with longer delay
    
    // Parse JSON response with better error handling
    try {
      // Clean up potential markdown code blocks
      const cleanedResult = result.replace(/```json\n?|```\n?/g, '').trim();
      const parsed = JSON.parse(cleanedResult) as SummaryWithSentiment;
      
      // Clean up summary - remove any English sentences that might be appended
      let cleanSummary = parsed.summary || title;
      
      // Remove common English patterns that might appear at the end or middle
      cleanSummary = cleanSummary
        // Remove sentences starting with common English words
        .replace(/\. [A-Z][a-z]+ (is|are|was|were|has|have|will|would|could|should|can|may|might|had|been|being)[^.]*\./g, '.')
        .replace(/\. The [^.]*\./g, '.')
        .replace(/\. This [^.]*\./g, '.')
        .replace(/\. It [^.]*\./g, '.')
        .replace(/\. According to [^.]*\./g, '.')
        .replace(/\. In [^.]*\./g, '.')
        .replace(/\. On [^.]*\./g, '.')
        .replace(/\. At [^.]*\./g, '.')
        .replace(/\. For [^.]*\./g, '.')
        .replace(/\. With [^.]*\./g, '.')
        .replace(/\. From [^.]*\./g, '.')
        .replace(/\. By [^.]*\./g, '.')
        .replace(/\. As [^.]*\./g, '.')
        .replace(/\. However[^.]*\./g, '.')
        .replace(/\. Additionally[^.]*\./g, '.')
        .replace(/\. Furthermore[^.]*\./g, '.')
        .replace(/\. Meanwhile[^.]*\./g, '.')
        .replace(/\. Moreover[^.]*\./g, '.')
        // Remove any remaining text after common English verbs/conjunctions
        .replace(/\s+(is|are|was|were|has|have|had|been|being)\s+[a-z][^.]*$/gi, '')
        .replace(/\s+(the|this|that|these|those|it|he|she|they)\s+[a-z][^.]*$/gi, '')
        // Remove standalone English words at the end
        .replace(/\s+[A-Z][a-z]+\s*$/g, '')
        .trim()
        // Clean up any double periods
        .replace(/\.+/g, '.')
        .replace(/\.\s*$/g, '.');
      
      console.log('✅ Summarization successful');
      
      return {
        summary: cleanSummary && cleanSummary.length > 10 ? cleanSummary : title,
        sentiment: ['positive', 'negative', 'neutral'].includes(parsed.sentiment) ? parsed.sentiment : 'neutral'
      };
    } catch (parseError) {
      console.warn('JSON parsing failed, using result as summary:', parseError);
      // If JSON parsing fails but we have content, use it as summary
      if (result && result.length > 10) {
        return { summary: result, sentiment: 'neutral' };
      }
      throw parseError;
    }
  } catch (error) {
    console.error('❌ Summarization error:', error instanceof Error ? error.message : error);
    
    // Fallback: Try simple translation without summarization
    try {
      console.log('🔄 Trying simple translation fallback...');
      const translatedTitle = await retryWithBackoff(
        () => translateToTurkish(title),
        2,
        1000
      );
      
      // More lenient verification - accept translation if it's different or long enough
      const isDifferent = translatedTitle.toLowerCase() !== title.toLowerCase();
      const isLongEnough = translatedTitle.length > 8;
      const hasNonEnglishChars = /[üğışöçÜĞİŞÖÇ]/.test(translatedTitle);
      
      if (translatedTitle && (isDifferent || isLongEnough || hasNonEnglishChars)) {
        console.log('✅ Translation fallback successful');
        return { summary: translatedTitle, sentiment: 'neutral' };
      } else {
        // Last resort: return original title instead of skipping
        console.warn('⚠️ Translation could not be verified, using original');
        return { summary: title, sentiment: 'neutral' };
      }
    } catch (translationError) {
      console.error('❌ Translation fallback failed:', translationError instanceof Error ? translationError.message : translationError);
      // Last resort: return original title instead of throwing
      return { summary: title, sentiment: 'neutral' };
    }
  }
}

/**
 * Summarize news in English and analyze sentiment
 * Creates a concise summary in English and determines if news is positive/negative
 * Includes retry mechanism for better reliability
 */
export async function summarizeInEnglish(title: string, text?: string): Promise<SummaryWithSentiment> {
  try {
    // Truncate content if too long (max 2000 chars)
    let content = text ? `${title}\n\n${text}` : title;
    if (content.length > 2000) {
      content = content.substring(0, 2000) + '...';
    }
    
    if (!content || content.trim().length === 0) {
      return { summary: title, sentiment: 'neutral' };
    }

    // Use retry mechanism for API calls
    const result = await retryWithBackoff(async () => {
      const response = await openaiChatCompletion({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a crypto news analysis expert. Analyze the given news and return in this JSON format:
{
  "summary": "Brief English summary of the news (2-3 sentences, keep important details)",
  "sentiment": "positive or negative or neutral"
}

IMPORTANT NOTES:
- Summary must be ONLY in English, no other languages
- Keep it concise and clear
- Do not include the original text in other languages
- Only return the English summary, nothing else

Sentiment criteria:
- positive: Price increases, positive developments, good news, growth, achievements
- negative: Price drops, hacks, scams, legal issues, bad news
- neutral: Objective information, analysis, neutral announcements

Return only JSON format, nothing else.`
          },
          {
            role: 'user',
            content: content
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      });

      return response.choices[0]?.message?.content || '';
    }, 2, 1500);
    
    // Parse JSON response with better error handling
    try {
      // Clean up potential markdown code blocks
      const cleanedResult = result.replace(/```json\n?|```\n?/g, '').trim();
      const parsed = JSON.parse(cleanedResult) as SummaryWithSentiment;
      
      return {
        summary: parsed.summary && parsed.summary.length > 10 ? parsed.summary : title,
        sentiment: ['positive', 'negative', 'neutral'].includes(parsed.sentiment) ? parsed.sentiment : 'neutral'
      };
    } catch (parseError) {
      console.warn('JSON parsing failed, using result as summary:', parseError);
      // If JSON parsing fails but we have content, use it as summary
      if (result && result.length > 10) {
        return { summary: result, sentiment: 'neutral' };
      }
      throw parseError;
    }
  } catch (error) {
    console.error('Summarization error:', error);
    // Ultimate fallback: return original title
    return { summary: title, sentiment: 'neutral' };
  }
}
