import type { Tool } from './types';
import registry from './tools.json';

export const tools = registry as Tool[];
