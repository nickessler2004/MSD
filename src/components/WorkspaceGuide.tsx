import { useState } from "react";
import { ViewButtons } from "./WorkspaceViews";

export function WorkspaceGuide() {
  const [topic, setTopic] = useState<"status" | "thresholds" | "sharing">(
    "status",
  );
  return (
    <div className="ws-guide">
      <ViewButtons
        label="Guide topics"
        value={topic}
        options={[
          ["status", "Live status"],
          ["thresholds", "Thresholds"],
          ["sharing", "Sharing"],
        ]}
        onChange={setTopic}
      />
      {topic === "status" ? (
        <>
          <h2>Source freshness</h2>
          <p>
            GPS uses source timestamps: a recent fix is within 5 seconds;
            gateway reports within 15 seconds. Realtime connectivity alone does
            not confirm live GPS.
          </p>
          <p>Offline or stale readings never confirm current motion.</p>
        </>
      ) : topic === "thresholds" ? (
        <>
          <h2>Threshold rules</h2>
          <p>
            Green: A &lt; T1; yellow: T1 ≤ A ≤ T2; red: A &gt; T2. Event reports
            preserve the thresholds recorded at that time.
          </p>
          <p>
            IMU silence never confirms safe motion. Saving cloud thresholds does
            not confirm hardware delivery.
          </p>
        </>
      ) : (
        <>
          <h2>Session access</h2>
          <p>
            Session owners control sharing. Database permissions deny
            unauthorized reads immediately after revocation; membership lists
            reconcile within 10 seconds.
          </p>
          <p>
            Observers can read shared records but cannot upload or change that
            session’s configuration.
          </p>
        </>
      )}
    </div>
  );
}
