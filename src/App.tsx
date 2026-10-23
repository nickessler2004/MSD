import { lazy, Suspense, useState } from "react";
import LocalDashboard from "./LocalDashboard";
import type { TelemetryMode } from "./domain/types";

const CloudDashboard = lazy(() =>
  import("./components/CloudDashboard").then((module) => ({
    default: module.CloudDashboard,
  })),
);

export default function App() {
  const [source, setSource] = useState<TelemetryMode | "cloud">("simulation");
  return source === "cloud" ? (
    <Suspense
      fallback={
        <main className="cloud-main">
          <p role="status">Loading cloud dashboard…</p>
        </main>
      }
    >
      <CloudDashboard onModeChange={setSource} />
    </Suspense>
  ) : (
    <LocalDashboard
      initialMode={source}
      onCloudMode={() => setSource("cloud")}
    />
  );
}
