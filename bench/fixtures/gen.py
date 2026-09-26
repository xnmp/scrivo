#!/usr/bin/env python3
"""Generate deterministic markdown fixtures for startup benchmarks.

medium.md  ~ a long-ish real-world note (~400 lines)
large.md   ~ a 1 MB+ document (~20k lines) to expose O(n) startup costs
"""
from pathlib import Path

HERE = Path(__file__).parent

HEADER = "# Benchmark Document\n\nThe first heading above is the readiness marker the harness waits for.\n\n"

SECTION = """\
## Section {n}: Notes on the system

This paragraph has **bold text**, *italic text*, ~~strikethrough~~, `inline code`,
and a [link to example.com](https://example.com/{n}). It also has an autolink
<https://example.org/{n}> and some trailing prose to wrap across the line so the
layout engine has real work to do when measuring text runs.

> A blockquote with **emphasis** inside it, spanning
> two source lines.

- First bullet with `code`
- Second bullet
  - Nested bullet {n}
  - Another nested bullet
- Third bullet

1. Ordered one
2. Ordered two
3. Ordered three

- [x] Completed task {n}
- [ ] Open task {n}

| Column A | Column B | Column C |
| -------- | :------: | -------: |
| a{n}     | b{n}     | c{n}     |
| longer cell content | centered | 12.50 |

```python
def fib_{n}(k: int) -> int:
    a, b = 0, 1
    for _ in range(k):
        a, b = b, a + b
    return a
```

```rust
fn main() {{
    let v: Vec<u32> = (0..{n}).collect();
    println!("{{}}", v.iter().sum::<u32>());
}}
```

Inline math $e^{{i\\pi}} + 1 = 0$ and a display block:

$$
\\int_0^\\infty e^{{-x^2}}\\,dx = \\frac{{\\sqrt{{\\pi}}}}{{2}}
$$

---

"""


def build(sections: int) -> str:
    return HEADER + "".join(SECTION.format(n=i) for i in range(1, sections + 1))


def main() -> None:
    (HERE / "medium.md").write_text(build(8))
    (HERE / "large.md").write_text(build(400))


if __name__ == "__main__":
    main()
