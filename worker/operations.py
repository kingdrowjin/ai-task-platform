"""Supported task operations."""


def op_uppercase(text: str) -> str:
    return text.upper()


def op_lowercase(text: str) -> str:
    return text.lower()


def op_reverse(text: str) -> str:
    return text[::-1]


def op_word_count(text: str) -> str:
    return str(len(text.split()))


REGISTRY = {
    "uppercase": op_uppercase,
    "lowercase": op_lowercase,
    "reverse": op_reverse,
    "word_count": op_word_count,
}


def run_operation(name: str, text: str) -> str:
    if name not in REGISTRY:
        raise ValueError(f"unknown operation: {name}")
    return REGISTRY[name](text)
