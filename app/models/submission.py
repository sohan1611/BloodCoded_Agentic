"""A blank submission is not student evidence and must never reach grading.

Otherwise an accidental submit is recorded as a failure, mutating mastery and
generating downstream work for code that does not exist.
"""

EMPTY_SUBMISSION_MESSAGE = "Enter some code before submitting."


def is_blank_submission(code: str | None) -> bool:
    return code is None or code.strip() == ""
