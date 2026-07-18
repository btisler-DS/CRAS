import type { RuntimeEvent } from "../ui/runtime-view.js";

interface EventTimelineProps {
  readonly events: readonly RuntimeEvent[];
}

export function EventTimeline({ events }: EventTimelineProps) {
  return (
    <section className="panel timeline-panel" aria-labelledby="timeline-heading">
      <span className="eyebrow">Server-owned lifecycle</span>
      <h2 id="timeline-heading">Event timeline</h2>
      <ol className="timeline" data-testid="event-timeline">
        {events.map((event) => (
          <li key={event.id}>
            <span className="timeline-marker" />
            <div>
              <strong>{event.state.replaceAll("_", " ")}</strong>
              <p>{event.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
