/**
 * AI provider abstraction — server-side only. The web client never sees a key.
 * Providers return *candidate* question drafts; the gateway validates, de-duplicates and files them
 * into pending_review. They never approve, score, or read user data.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod/v4';

export const DraftSchema = z.object({
  questions: z.array(
    z.object({
      prompt: z.string().min(8).max(500),
      options: z.array(z.string().min(1).max(200)).min(3).max(6),
      correctIndex: z.number().int().min(0).max(5),
      explanation: z.string().max(600),
      tags: z.array(z.string().max(30)).max(5),
    }),
  ),
});
export type DraftQuestion = z.infer<typeof DraftSchema>['questions'][number];

export interface DraftRequest {
  categoryName: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
  language: 'ar' | 'en';
  count: number;
  topic?: string;
}
export interface DraftResult {
  questions: DraftQuestion[];
  model: string;
  inputTokens: number;
  outputTokens: number;
}
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  draftQuestions(req: DraftRequest): Promise<DraftResult>;
}

const SYSTEM = `You write quiz questions for a bilingual (Arabic/English) trivia platform.
Rules: factual, verifiable, unambiguous, one correct option, distractors plausible, no religious rulings,
scripture, hadith or attributions to religious figures (those are handled by human specialists with sources).
Write everything in the requested language only. Keep prompts under 200 characters.`;

/** Anthropic Messages API with structured output (schema-validated JSON). */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private client: Anthropic;
  constructor(apiKey: string, model = 'claude-opus-5') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }
  async draftQuestions(req: DraftRequest): Promise<DraftResult> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content:
            `Write ${req.count} ${req.difficulty} multiple-choice questions in ${req.language === 'ar' ? 'Arabic' : 'English'} ` +
            `for the category "${req.categoryName}"${req.topic ? ` about "${req.topic}"` : ''}. Return exactly ${req.count} questions.`,
        },
      ],
      output_config: { format: zodOutputFormat(DraftSchema) },
    });
    if (response.stop_reason === 'refusal') throw new Error('provider refused the request');
    const parsed = response.parsed_output;
    if (!parsed) throw new Error('provider returned no structured output');
    return {
      questions: parsed.questions,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}

/** Deterministic provider for tests and local development (AI_PROVIDER=mock). Never used implicitly. */
export class MockProvider implements AiProvider {
  readonly name = 'mock';
  readonly model = 'mock-1';
  async draftQuestions(req: DraftRequest): Promise<DraftResult> {
    const questions: DraftQuestion[] = Array.from({ length: req.count }, (_, i) => ({
      prompt: req.language === 'ar' ? `سؤال تجريبي ${i + 1} عن ${req.categoryName}؟` : `Mock question ${i + 1} about ${req.categoryName}?`,
      options: req.language === 'ar' ? ['الإجابة الصحيحة', 'خيار ب', 'خيار ج', 'خيار د'] : ['Correct answer', 'Option B', 'Option C', 'Option D'],
      correctIndex: 0,
      explanation: req.language === 'ar' ? 'شرح تجريبي' : 'Mock explanation',
      tags: ['mock'],
    }));
    return { questions, model: this.model, inputTokens: 10 * req.count, outputTokens: 40 * req.count };
  }
}

let cached: AiProvider | null | undefined;
/** Resolved once from the environment; null when AI is disabled (the default). */
export function getAiProvider(): AiProvider | null {
  if (cached !== undefined) return cached;
  const kind = process.env.AI_PROVIDER ?? '';
  if (kind === 'anthropic' && process.env.AI_API_KEY) cached = new AnthropicProvider(process.env.AI_API_KEY, process.env.AI_MODEL || undefined);
  else if (kind === 'mock') cached = new MockProvider();
  else cached = null;
  return cached;
}
export function _resetAiProvider(): void { cached = undefined; }
