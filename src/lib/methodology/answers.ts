/**
 * Kind-vs-value answer validation, shared by the survey autosave action and
 * the (Phase 5) Excel importer — a single validation path for both.
 */

export type AnswerKind = "SCORE_1_5" | "TEXT" | "NUMBER" | "CURRENCY" | "DATE" | "BOOLEAN" | "OPTION";

export interface AnswerQuestionShape {
  answerKind: AnswerKind;
  /** For OPTION questions: the engagement's option-list values. */
  allowedOptions?: readonly string[];
}

export interface NormalizedAnswer {
  isNA: boolean;
  numericValue?: number;
  textValue?: string;
  boolValue?: boolean;
}

export type AnswerValidation = { ok: true; value: NormalizedAnswer } | { ok: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateAnswer(question: AnswerQuestionShape, raw: unknown): AnswerValidation {
  // Every survey question may be declined with an explicit N/A (quirk #2).
  if (raw === "NA") return { ok: true, value: { isNA: true } };

  switch (question.answerKind) {
    case "SCORE_1_5": {
      if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 5) {
        return { ok: true, value: { isNA: false, numericValue: raw } };
      }
      return { ok: false, error: "Expected an integer 1–5 or N/A" };
    }
    case "TEXT": {
      if (typeof raw === "string") return { ok: true, value: { isNA: false, textValue: raw } };
      return { ok: false, error: "Expected text" };
    }
    case "NUMBER":
    case "CURRENCY": {
      if (typeof raw === "number" && Number.isFinite(raw)) {
        return { ok: true, value: { isNA: false, numericValue: raw } };
      }
      return { ok: false, error: "Expected a finite number" };
    }
    case "BOOLEAN": {
      if (typeof raw === "boolean") return { ok: true, value: { isNA: false, boolValue: raw } };
      return { ok: false, error: "Expected yes/no" };
    }
    case "DATE": {
      if (typeof raw === "string" && ISO_DATE.test(raw) && !Number.isNaN(Date.parse(raw))) {
        return { ok: true, value: { isNA: false, textValue: raw } };
      }
      return { ok: false, error: "Expected an ISO date (YYYY-MM-DD)" };
    }
    case "OPTION": {
      if (typeof raw !== "string") return { ok: false, error: "Expected an option value" };
      if (question.allowedOptions && !question.allowedOptions.includes(raw)) {
        return { ok: false, error: `"${raw}" is not one of the configured options` };
      }
      return { ok: true, value: { isNA: false, textValue: raw } };
    }
  }
}
