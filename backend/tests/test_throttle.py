from datetime import timedelta

from app.auth.throttle import MAX_KEYS, LoginThrottle

MAX_FAILURES = 3
WINDOW = timedelta(minutes=10)


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def throttle_with(clock: Clock) -> LoginThrottle:
    return LoginThrottle(max_failures=MAX_FAILURES, window=WINDOW, clock=clock)


def test_locks_after_too_many_failures_and_unlocks_later() -> None:
    clock = Clock()
    throttle = throttle_with(clock)
    for _ in range(MAX_FAILURES):
        assert throttle.retry_after("ip:login") == 0
        throttle.failed("ip:login")
    assert 0 < throttle.retry_after("ip:login") <= WINDOW.total_seconds() + 1
    assert throttle.retry_after("other-ip:login") == 0

    clock.now += WINDOW.total_seconds() + 1
    assert throttle.retry_after("ip:login") == 0


def test_success_resets_the_counter() -> None:
    throttle = throttle_with(Clock())
    for _ in range(MAX_FAILURES - 1):
        throttle.failed("key")
    throttle.succeeded("key")
    throttle.failed("key")
    assert throttle.retry_after("key") == 0


def test_memory_stays_bounded() -> None:
    throttle = throttle_with(Clock())
    for i in range(MAX_KEYS + 10):
        throttle.failed(f"key-{i}")
    assert len(throttle._failures) <= MAX_KEYS
