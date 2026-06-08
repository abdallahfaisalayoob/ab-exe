import { ContactShadows, Grid, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useRef } from "react";
import { boardScale } from "../../lib/cnc3d";
import type { EngravingPlan } from "../../lib/engraving";
import type { Geometry, TelemetrySample, Toolpath } from "../../types/simulator";
import { MachineFrame } from "./MachineFrame";
import { MaterialRemovalLayer } from "./MaterialRemovalLayer";
import { PCBModel } from "./PCBModel";
import { ToolHead } from "./ToolHead";
import { ToolpathRenderer } from "./ToolpathRenderer";

export type CameraPreset = "iso" | "top" | "front";

interface Props {
  geometry: Geometry;
  toolpath: Toolpath;
  frame: TelemetrySample | null;
  simTimeSec: number;
  resetViewSignal: number;
  cameraPreset: CameraPreset;
  cameraPresetSignal: number;
  bitDiameterMm: number;
  engravingPlan: EngravingPlan | null;
  showEngravingPreview: boolean;
}

function SceneContents({
  geometry,
  toolpath,
  frame,
  simTimeSec,
  resetViewSignal,
  cameraPreset,
  cameraPresetSignal,
  bitDiameterMm,
  engravingPlan,
  showEngravingPreview,
}: Props) {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();
  const mapped = boardScale(geometry.board);
  const cameraDistance = Math.max(mapped.width, mapped.depth) * 1.08;

  useEffect(() => {
    controlsRef.current?.reset?.();
  }, [resetViewSignal]);

  useEffect(() => {
    controlsRef.current?.target?.set(0, 0.05, 0);
    if (cameraPreset === "top") {
      camera.position.set(0, cameraDistance * 1.25, 0.01);
    } else if (cameraPreset === "front") {
      camera.position.set(0, cameraDistance * 0.28, cameraDistance * 1.28);
    } else {
      camera.position.set(cameraDistance * 0.72, cameraDistance * 0.78, cameraDistance * 0.92);
    }
    camera.lookAt(0, 0.05, 0);
    camera.updateProjectionMatrix();
    controlsRef.current?.reset?.();
  }, [camera, cameraDistance, cameraPreset, cameraPresetSignal]);

  return (
    <>
      <PerspectiveCamera makeDefault position={[cameraDistance * 0.72, cameraDistance * 0.78, cameraDistance * 0.92]} fov={44} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={4}
        maxDistance={18}
        maxPolarAngle={Math.PI * 0.48}
        target={[0, 0.05, 0]}
      />
      <ambientLight intensity={0.62} />
      <directionalLight position={[4, 7, 5]} intensity={2.4} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <pointLight position={[-5, 4, -4]} intensity={0.42} color="#31c6df" />
      <PCBModel geometry={geometry} />
      <MaterialRemovalLayer geometry={geometry} toolpath={toolpath} simTimeSec={simTimeSec} bitDiameterMm={bitDiameterMm} />
      <ToolpathRenderer
        geometry={geometry}
        toolpath={toolpath}
        simTimeSec={simTimeSec}
        engravingPlan={engravingPlan}
        showEngravingPreview={showEngravingPreview}
      />
      <ToolHead board={geometry.board} frame={frame} />
      <MachineFrame board={geometry.board} />
      <Grid
        args={[Math.max(mapped.width, mapped.depth) + 3, Math.max(mapped.width, mapped.depth) + 3]}
        position={[0, -0.18, 0]}
        cellSize={0.5}
        cellThickness={0.45}
        cellColor="#334155"
        sectionSize={2}
        sectionThickness={0.8}
        sectionColor="#475569"
        fadeDistance={20}
        fadeStrength={1}
        infiniteGrid={false}
      />
      <ContactShadows position={[0, -0.18, 0]} opacity={0.36} scale={14} blur={2.5} far={4} />
    </>
  );
}

export function CNCScene(props: Props) {
  return (
    <Canvas shadows dpr={[1, 2]} gl={{ antialias: true, preserveDrawingBuffer: true }} className="h-full min-h-[360px] w-full">
      <Suspense fallback={null}>
        <color attach="background" args={["#101519"]} />
        <fog attach="fog" args={["#101519", 11, 22]} />
        <SceneContents {...props} />
      </Suspense>
    </Canvas>
  );
}
