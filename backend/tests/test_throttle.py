from datetime import timedelta

from app.auth.throttle import MAX_KEYS, LoginGuard, LoginThrottle

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


def guard_with(clock: Clock, per_address: int) -> LoginGuard:
    return LoginGuard(
        per_login=throttle_with(clock),
        per_address=LoginThrottle(max_failures=per_address, window=WINDOW, clock=clock),
    )


def test_guard_limits_failures_from_one_address_across_logins() -> None:
    guard = guard_with(Clock(), per_address=5)
    for i in range(5):
        assert guard.retry_after("10.0.0.1", f"user-{i}") == 0
        guard.failed("10.0.0.1", f"user-{i}")
    # Каждый логин пробовали один раз, но адрес исчерпал свой предел.
    assert guard.retry_after("10.0.0.1", "someone-else") > 0
    assert guard.retry_after("10.0.0.2", "someone-else") == 0


def test_guard_success_does_not_reset_the_address_counter() -> None:
    guard = guard_with(Clock(), per_address=3)
    for i in range(3):
        guard.failed("10.0.0.1", f"victim-{i}")
    guard.succeeded("10.0.0.1", "attacker")
    assert guard.retry_after("10.0.0.1", "victim-0") > 0


def test_guard_still_locks_a_single_login() -> None:
    guard = guard_with(Clock(), per_address=100)
    for _ in range(MAX_FAILURES):
        guard.failed("10.0.0.1", "ivanov")
    assert guard.retry_after("10.0.0.1", "ivanov") > 0
    assert guard.retry_after("10.0.0.1", "petrov") == 0
