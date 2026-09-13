export const EMPTY_SUBMISSION_MESSAGE = "Enter some code before submitting.";

export type SubmissionCheck = { ok: true } | { ok: false; message: string };

export function checkSubmission(code: string): SubmissionCheck {
  if (code.trim() === "") {
    return { ok: false, message: EMPTY_SUBMISSION_MESSAGE };
  }
  return { ok: true };
}
