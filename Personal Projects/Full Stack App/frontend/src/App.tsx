import { useEffect } from "react";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { FinalPcbView } from "./components/FinalPcbView";
import { LaserEngravingPanel } from "./components/LaserEngravingPanel";
import { Simulation3DPanel } from "./components/Simulation3DPanel";
import { Timeline } from "./components/Timeline";
import { TopBar } from "./components/TopBar";
import { UploadPanel } from "./components/UploadPanel";
import { useSimulatorStore } from "./store/simulatorStore";

function App() {
  const loadSamples = useSimulatorStore((state) => state.loadSamples);
  const sidebarCollapsed = useSimulatorStore((state) => state.sidebarCollapsed);

  useEffect(() => {
    void loadSamples();
  }, [loadSamples]);

  return (
    <div className="flex h-screen min-h-[760px] flex-col overflow-hidden text-slate-100">
      <TopBar />
      <main
        className={`grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 ${
          sidebarCollapsed ? "lg:grid-cols-[72px_minmax(520px,1fr)_390px]" : "lg:grid-cols-[320px_minmax(520px,1fr)_390px]"
        }`}
      >
        <UploadPanel />
        <div className="flex min-h-0 flex-col gap-3">
          <Simulation3DPanel />
        </div>
        <div className="flex min-h-0 flex-col gap-3">
          <FinalPcbView />
          <LaserEngravingPanel />
          <DiagnosticsPanel />
        </div>
      </main>
      <Timeline />
    </div>
  );
}

export default App;
