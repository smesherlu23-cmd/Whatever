from app.auth.throttle import MAX_FAILURES, MAX_KEYS, WINDOW_SECONDS, LoginThrottle


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_locks_after_too_many_failures_and_unlocks_later() -> None:
    clock = Clock()
    throttle = LoginThrottle(clock)
    for _ in range(MAX_FAILURES):
        assert throttle.retry_after("ip:login") == 0
        throttle.failed("ip:login")
    assert throttle.retry_after("ip:login") > 0
    assert throttle.retry_after("other-ip:login") == 0

    clock.now += WINDOW_SECONDS + 1
    assert throttle.retry_after("ip:login") == 0


def test_success_resets_the_counter() -> None:
    throttle = LoginThrottle(Clock())
    for _ in range(MAX_FAILURES - 1):
        throttle.failed("key")
    throttle.succeeded("key")
    throttle.failed("key")
    assert throttle.retry_after("key") == 0


def test_memory_stays_bounded() -> None:
    clock = Clock()
    throttle = LoginThrottle(clock)
    for i in range(MAX_KEYS + 10):
        throttle.failed(f"key-{i}")
    assert len(throttle._failures) <= MAX_KEYS
