import { Cylinder } from "@react-three/drei";
import { useMemo } from "react";
import { boardScale, executedSegments, toWorld } from "../../lib/cnc3d";
import type { Geometry, Toolpath } from "../../types/simulator";

interface Props {
  geometry: Geometry;
  toolpath: Toolpath;
  simTimeSec: number;
  bitDiameterMm: number;
}

function RemovedStrip({ start, end, width }: { start: [number, number, number]; end: [number, number, number]; width: number }) {
  const dx = end[0] - start[0];
  const dz = end[2] - start[2];
  const length = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
  const angle = Math.atan2(dz, dx);
  return (
    <mesh position={[(start[0] + end[0]) / 2, 0.071, (start[2] + end[2]) / 2]} rotation={[0, -angle, 0]}>
      <boxGeometry args={[length, 0.012, width]} />
      <meshStandardMaterial color="#071013" roughness={0.86} />
    </mesh>
  );
}

export function MaterialRemovalLayer({ geometry, toolpath, simTimeSec, bitDiameterMm }: Props) {
  const mapped = useMemo(() => boardScale(geometry.board), [geometry.board]);
  const segments = useMemo(() => executedSegments(toolpath.moves, simTimeSec), [toolpath.moves, simTimeSec]);

  return (
    <group>
      {segments.map((segment) => {
        if (segment.mode === "drill") {
          const end = toWorld(segment.end, geometry.board, 0.08);
          const radius = Math.max(0.035, ((segment.end.z ?? 0) < 0 ? bitDiameterMm / 2 : bitDiameterMm / 3) * mapped.scale);
          return (
            <Cylinder key={segment.id} args={[radius, radius, 0.014, 28]} position={[end.x, 0.078, end.z]}>
              <meshStandardMaterial color="#05090b" roughness={0.9} />
            </Cylinder>
          );
        }
        if (segment.mode !== "cut" && segment.mode !== "engrave") {
          return null;
        }
        const start = toWorld(segment.start, geometry.board, 0.08);
        const end = toWorld(segment.end, geometry.board, 0.08);
        const width = (segment.mode === "engrave" ? 0.22 : (toolpath.bit_diameter_mm ?? bitDiameterMm)) * mapped.scale;
        return <RemovedStrip key={segment.id} start={[start.x, start.y, start.z]} end={[end.x, end.y, end.z]} width={Math.max(0.022, width)} />;
      })}
    </group>
  );
}
