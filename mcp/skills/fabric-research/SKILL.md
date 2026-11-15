---
name: fabric-research
description: Research a YouTube video (talk, podcast, lecture, interview) with Fabric patterns through the Fabric MCP connector. Use whenever the user shares a YouTube link or asks to research, analyze, summarize, fact-check, take notes on, or pull ideas, sources, quotes or actions from a video. Chooses several fitting Fabric patterns for the user's goal instead of defaulting to extract_wisdom.
---

# Fabric research

Fabric's value is its patterns. A transcript is only the input. Pick the patterns that fit what the user wants, run all of them on one transcript, then answer the user's goal.

## Steps

1. **State the goal.** Restate what the user wants in one line, in their words. If they gave only a link, treat the goal as general research: what is said, whether it holds up, what to read next, what to do with it.
2. **Get candidates.** Call `recommend_patterns` with that goal.
3. **Choose 2-4 patterns.** From the candidates, pick a set that covers the goal with little overlap. Typical sets:
   - General research: `youtube_summary`, `extract_insights`, `analyze_claims`, `extract_references`
   - Lessons from a founder or expert: `extract_wisdom`, `extract_business_ideas`, `extract_recommendations`
   - Is it credible: `analyze_claims`, `extract_extraordinary_claims`, `find_logical_fallacies`
   - Worth watching: `label_and_rate`, `youtube_summary`
   - Sources and follow-up reading: `extract_references`, `extract_book_recommendations`
   - Study: `summarize_lecture`, `to_flashcards`, `create_quiz`
   Use a single pattern only when the user names one or the ask is that narrow. Use `list_patterns` with a keyword if no candidate fits.
4. **Apply.** Call `apply_patterns` once with the URL, the chosen patterns and the goal. It fetches the transcript once.
5. **Run every pattern.** Follow each pattern's instructions exactly, each under its own heading.
6. **Synthesize.** End with a short section that answers the user's goal from all the results, and note where patterns disagree.
7. **Say what you used.** One line: which patterns and why.

## When a transcript fails

`apply_patterns` and `get_transcript` try the owner's server (yt-dlp) and then Bright Data. If both fail, the error lists each source and its reason. Report that text as given, and offer to run the same patterns on a transcript the user pastes. Do not guess at causes such as rate limits beyond what the error says.
