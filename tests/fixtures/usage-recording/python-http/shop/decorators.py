import functools


def traced(function):
    @functools.wraps(function)
    def wrapper(*args, **kwargs):
        return function(*args, **kwargs)
    return wrapper


def checked(function):
    @functools.wraps(function)
    def wrapper(*args):
        result = function(*args)
        assert result is not None
        return result
    return wrapper
