"""Ведро токенов для частоты сообщений одного подключения."""

from app.sync.limits import RateLimit


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_allows_a_burst_and_then_refuses() -> None:
    limit = RateLimit(rate=10, burst=3, clock=Clock())
    assert [limit.allow() for _ in range(4)] == [True, True, True, False]


def test_refills_at_the_given_rate() -> None:
    clock = Clock()
    limit = RateLimit(rate=10, burst=3, clock=clock)
    for _ in range(3):
        limit.allow()
    clock.now += 0.1  # за десятую секунды — ровно одно событие
    assert limit.allow()
    assert not limit.allow()


def test_a_long_pause_does_not_save_up_more_than_the_burst() -> None:
    clock = Clock()
    limit = RateLimit(rate=10, burst=3, clock=clock)
    clock.now += 3600
    assert [limit.allow() for _ in range(4)] == [True, True, True, False]
