# Market study — feature parity

Survey of the leading quiz/trivia products and how QUIZ PLATFORM covers their
signature mechanics. Sources: product usage + public comparisons (see README
of each product; e.g. [Kahoot vs Quizizz/Wayground comparisons](https://triviamaker.com/kahoot-vs-quizziz/),
[trivia app roundups](https://learnclash.com/blog/best-trivia-apps)).

| Product | Signature mechanic | Status here |
|---|---|---|
| **Kahoot!** | Timed competitive quizzes, points with speed bonus, podium | ✅ Timed mode + speed bonus (settings-driven), leaderboard podium |
| **Quizizz / Wayground** | Self-paced play, instant per-question feedback with explanation, power-ups | ✅ Practice mode: untimed, answer+explanation shown after each question; server-side power-ups |
| **Trivia Crack** | Category wheel, 50/50 & time power-ups, head-to-head | ✅ Categories with per-difficulty counts; 50/50 + time-extension (server-side, no answer leak); tournaments/challenges head-to-head |
| **Duolingo** | Streaks with **streak freeze**, XP/levels, gentle feedback, calm design | ✅ Timezone-aware streaks, banked streak freezes (auto-consumed, milestone-earned, capped), XP/level curve, calm focus palette |
| **Quizlet / Brainscape** | Spaced repetition, replay what you missed | ✅ Review-mistakes mode (only questions never later answered correctly) |
| **Wordle** | One shared daily puzzle + emoji share grid | ✅ Question of the Day: one deterministic set per date, one attempt per player, daily board; emoji outcome grid in Share |
| **QuizUp (legacy)** | Friends, rivalries, social profiles | ✅ Friend requests/accept/remove, friends leaderboard, public profiles |
| **AhaSlides / Mentimeter** | Polls & surveys inside quizzes | ✅ poll/survey/personality types (unscored, collected) |
| **Sporcle** | Massive question bank, many formats | ✅ 80 question types over 13 scoring families; import pipeline for large banks |

## Deliberately deferred (documented in ROADMAP)
- Live synchronized rooms (Kahoot's host-screen mode) → needs WebSocket infra.
- Ad/monetization mechanics → payments deferred; plan flags exist.
- Media-rich banks (image/audio/video hosting) → model supports media URLs; storage pipeline deferred.

## Focus & comfort design rationale (v3)
- **Palette**: low-saturation teal/sage — calm-associated hues — on warm ivory
  (no pure-white glare); dark mode is a warm green-black with reduced blue.
  All pairs kept at comfortable WCAG contrast.
- **Focus mode**: during play the app chrome disappears (no nav, no
  background texture); one question, one action. Exit is always visible.
- **Timer psychology**: practice is untimed by design (no anxiety while
  learning); timed mode keeps the ring calm until the final 5 seconds.
- **Feedback**: soft, brief audio cues (user-toggleable, off under
  reduced-motion); instant explanations in practice; no punishing reds —
  errors use a muted terracotta.
- **Motion**: short, purposeful transitions only; everything honors
  `prefers-reduced-motion`.
