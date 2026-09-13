import pytest


PROVIDER_KEYS = ("GROQ_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY")


@pytest.fixture(autouse=True)
def _no_live_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep tests offline even when load_dotenv populates a developer's keys.

    ProviderSpec.available reads os.environ at call time, so remove live credentials.
    A test wanting a provider "available" sets its own dummy key with
    monkeypatch.setenv, as tests/test_llm.py already does.
    """
    for name in PROVIDER_KEYS:
        monkeypatch.delenv(name, raising=False)
