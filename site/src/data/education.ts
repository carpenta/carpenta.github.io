import type { Certificate, EducationItem } from './types';

export const education: EducationItem[] = [
  {
    school: { ko: '한동대학교', en: 'Handong Global University' },
    detail: { ko: '전산전자공학부 학사', en: 'B.S., School of Computer Science and Electrical Engineering' },
    period: '2010.11',
  },
  {
    school: { ko: '속초고등학교', en: 'Sokcho High School' },
    detail: { ko: '자연계열', en: 'Natural sciences track' },
    period: '2003.12',
  },
];

export const certificates: Certificate[] = [
  { name: { ko: 'AWS Certified Developer', en: 'AWS Certified Developer' }, issuer: { ko: 'Amazon', en: 'Amazon' }, date: '2024.03' },
  { name: { ko: 'SCBCD', en: 'SCBCD' }, issuer: { ko: 'Sun', en: 'Sun' }, date: '2009.03' },
  { name: { ko: 'SCWCD', en: 'SCWCD' }, issuer: { ko: 'Sun', en: 'Sun' }, date: '2008.08' },
  { name: { ko: 'SCJP', en: 'SCJP' }, issuer: { ko: 'Sun', en: 'Sun' }, date: '2008.04' },
  { name: { ko: '정보처리기사', en: 'Engineer Information Processing' }, issuer: { ko: '한국산업인력공단', en: 'HRD Korea' }, date: '2006.06' },
];
