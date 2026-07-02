# Relay Product Roadmap

## VISION

Relay should evolve beyond an RSS generator.

The long-term vision is an intelligent news aggregation and curation platform for agencies, venture funds, investor relations teams, and communications professionals.

Relay should be built around a small set of durable product principles:

- Reliable
- Fast
- Editorial quality
- Explainable
- Modular
- Easy to configure
- Easy to trust

These principles should guide both product decisions and technical decisions. Relay should help operators assemble high-quality client news feeds without requiring a fragile workflow, constant babysitting, or black-box logic. The product should remain useful even as source types expand, feed logic becomes more sophisticated, and more clients are managed in parallel.

In the long term, Relay should become a dependable internal platform for curating client-facing intelligence feeds, not just a lightweight feed generator.

## MUST HAVE

Required before Relay should be treated as production-ready.

1. Reliable article ingestion
   - Sources refresh consistently without frequent silent failures.
   - Failed fetches are visible and understandable.
   - Source-level refresh behavior is stable enough for internal client use.

2. Stable RSS generation
   - Every enabled client feed reliably renders valid RSS.
   - Feed endpoints remain fast and dependable because results are cached.
   - Downstream consumers such as WordPress and client portals can use the feeds without manual intervention.

3. High-quality article relevance
   - Feeds should feel curated, not merely collected.
   - Category outputs should mostly surface articles that actually match client intent.
   - Relevance should be improved based on real usage and review, not speculative complexity.

4. Direct RSS source support
   - Relay should support direct publisher and publication RSS feeds alongside Google News.
   - Direct feeds should be treated as a core path for improving link quality and source reliability.

5. Multi-source architecture
   - Categories should be able to combine multiple source types cleanly.
   - The source system should remain modular so new providers can be added without rewriting the app.

6. Good duplicate detection
   - Feeds should avoid obvious repeated stories.
   - Duplicate handling should work across multiple searches and multiple source types.
   - Story selection should avoid noisy repetition while preserving the best article version.

7. Source health monitoring
   - Operators should be able to see which sources are healthy, degraded, empty, or failing.
   - Health visibility should be sufficient to debug problems quickly.

8. Refresh reliability
   - Automatic refresh should run consistently on schedule.
   - Manual refresh should work predictably per client.
   - Refresh outcomes should be visible enough to support operational trust.

9. Working external publisher links
   - Feed items should link to the original publisher article whenever possible.
   - Broken or unresolved Google News wrapper links should not be considered acceptable output.

10. Deployment stability
   - The deployed application should start reliably, persist data correctly, and serve public feeds consistently.
   - Admin routes and public feed routes should behave as expected in production.

11. Backup strategy
   - Relay needs a clear backup and recovery approach for database state, configuration, and critical deployment data.
   - Operators should be able to recover without guesswork if a deployment or data issue occurs.

## SHOULD HAVE

Important version 2 improvements that materially improve feed quality and operator control, but are not blockers for initial internal production use.

1. Client publisher preferences
   - Allow clients to favor or suppress specific publishers based on editorial needs.

2. Include/exclude filters
   - Add practical source- or category-level controls to remove obvious noise and improve focus.

3. Better duplicate clustering
   - Improve beyond simple title and URL deduplication so near-duplicate reporting is handled more intelligently.

4. Article scoring
   - Introduce transparent ranking logic that balances relevance, recency, and source quality.

5. Refresh reports
   - Provide clear summaries of what happened during each refresh, including fetched, skipped, deduplicated, and emitted counts.

6. Better search configuration
   - Make query management easier and safer for operators who tune feeds often.

7. Category templates
   - Continue improving starter templates so new clients can be launched faster with a sensible baseline.

8. Source prioritization
   - Allow some sources to be favored when similar stories appear from multiple places.

9. Feed quality inspector
   - Provide an internal review surface for validating why certain stories appeared and others did not.

## FUTURE IDEAS

These are worth exploring later, but they should not distract from validating the current product with real usage.

- AI-assisted categorization
- AI-generated summaries
- Story clustering across publishers
- Sentiment analysis
- Slack notifications
- Microsoft Teams notifications
- Email digests
- Analytics
- Trend detection
- Source reputation scoring
- Shared client templates
- Team collaboration

Additional future exploration areas:

- AI-assisted query suggestions
- Editorial review workflows
- Watchlist-level feed composition
- Cross-client template libraries
- Feed QA alerts for stale or low-quality output
- Historical feed archive and comparison views

These ideas should be prioritized only if they clearly strengthen Relay's role as a trusted curation product rather than turning it into a bloated media dashboard.

## PRODUCT PHILOSOPHY

Relay should never become bloated.

Every feature should answer one question:

"Does this improve the quality, reliability, or usability of the client's news feed?"

If not, it probably does not belong.

Relay should favor:

- Simplicity over cleverness
- Explainability over automation
- Modular architecture over one-off implementations
- Durable workflows over flashy features
- Operational trust over novelty

Relay should avoid publisher-specific hacks whenever possible. When special-case logic becomes necessary, it should be treated as a temporary compromise rather than the product strategy.

The product should remain intentionally narrow. It is not meant to become a general-purpose newsroom suite, social listening platform, or analytics-heavy dashboard unless real usage proves those additions are essential to feed quality and operator workflow.

The standard for inclusion should stay high: a feature should either improve output quality, improve reliability, or make the system easier to operate with confidence.

## CURRENT STATUS

### Completed

- Multi-client architecture
- Modular source system
- Google News source
- RSS source
- Template system
- Health monitoring
- Dashboard
- Railway deployment preparation
- Responsive UI
- Authentication
- Per-client RSS feeds

### Known limitations

- Google News URL resolution is still imperfect.
- Feed quality needs validation with real-world usage.
- More direct RSS sources should be added over time.
- Relevance tuning should be based on production experience rather than assumptions.

### Current operating posture

Relay is now at the point where it can be treated as an internal product for active use rather than a pure prototype. The right next move is not a large backend refactor. The right next move is to deploy the current version, run real client feeds through it, observe failure modes, review article quality, and learn from actual operator usage.

This means the current app should be judged primarily on:

- whether feeds are reliable enough to use repeatedly
- whether article selection is useful in real client contexts
- whether source failures are visible and manageable
- whether the product saves time in an actual editorial workflow

That validation period should shape the next round of engineering priorities.

## NEXT STEP

After this roadmap is created, development should pause.

Immediate next step:

1. Deploy the current version.
2. Use Relay internally with real client feeds for several weeks.
3. Gather feedback on:
   - article quality
   - source reliability
   - duplicate behavior
   - refresh reliability
   - operator usability
   - link correctness
4. Reprioritize improvements based on actual usage rather than assumptions.

Explicitly not doing next:

- Do not begin Phase 1.
- Do not refactor the backend yet.
- Do not add new features right now.

This roadmap should serve as the guiding product document for Relay going forward. It defines the intended direction, the current boundary, and the criteria for future prioritization.
