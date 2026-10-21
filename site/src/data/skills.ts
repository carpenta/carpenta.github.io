import type { SkillGroup } from './types';

export const skills: SkillGroup[] = [
  { name: { ko: 'Languages', en: 'Languages' }, items: ['Java', 'Kotlin', 'Python', 'Go'] },
  { name: { ko: 'Data & Infrastructure', en: 'Data & Infrastructure' }, items: ['Apache Spark', 'Hadoop (HDFS/MapReduce)', 'Kafka', 'HBase', 'Redis', 'Kubernetes', 'Airflow'] },
  { name: { ko: 'AI & Search', en: 'AI & Search' }, items: ['LLM Gateway', 'Vector Database', 'RAG', 'ElasticSearch'] },
  { name: { ko: 'DevOps & Tools', en: 'DevOps & Tools' }, items: ['Docker', 'Datadog', 'Git', 'CI/CD Pipelines'] },
];
