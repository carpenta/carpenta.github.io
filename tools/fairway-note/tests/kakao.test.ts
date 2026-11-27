import { describe, expect, it } from 'vitest';
import { kakaoInApp } from '../src/kakao';

// v47 (U4): KakaoTalk's in-app browser tells itself by "KAKAOTALK" in its User-Agent (as KakaoTalk's developer documents
// say); the notice shows the steps of that phone's KakaoTalk menu.
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36;KAKAOTALK 2410590';
const ANDROID_TALK_CHANNEL = 'Mozilla/5.0 (Linux; Android 14; SM-S901N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.0.0 Mobile Safari/537.36 KAKAOTALK/11.1.2 (PFINAPP)';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.5';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const NAVER_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.10.1)';

describe("KakaoTalk's in-app browser (v47)", () => {
  it('is told by KAKAOTALK in the User-Agent, with the phone it runs on', () => {
    expect(kakaoInApp(ANDROID)).toBe('android');
    expect(kakaoInApp(ANDROID_TALK_CHANNEL)).toBe('android');
    expect(kakaoInApp(IPHONE)).toBe('ios');
    expect(kakaoInApp('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.5')).toBe('ios');
    // KakaoTalk on a computer, or a phone it cannot tell: the notice gives both phones' steps.
    expect(kakaoInApp('Mozilla/5.0 (Windows NT 10.0; Win64; x64) KAKAOTALK 3.4.5')).toBe('other');
  });

  it('is not KakaoTalk in a phone\'s own browser or in another app\'s', () => {
    for (const ua of [CHROME_ANDROID, SAFARI_IPHONE, NAVER_APP, '']) expect(kakaoInApp(ua), ua).toBeNull();
  });
});
