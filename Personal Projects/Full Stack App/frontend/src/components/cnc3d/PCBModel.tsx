import { Cylinder, RoundedBox } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { boardScale, toWorld } from "../../lib/cnc3d";
import type { Geometry, Point } from "../../types/simulator";

interface Props {
  geometry: Geometry;
}

function TraceStrip({ start, end, widthMm, geometry }: { start: Point; end: Point; widthMm: number; geometry: Geometry }) {
  const scale = boardScale(geometry.board).scale;
  const a = toWorld({ ...start, z: 0.05 }, geometry.board);
  const b = toWorld({ ...end, z: 0.05 }, geometry.board);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
  const angle = Math.atan2(dz, dx);
  return (
    <mesh position={[(a.x + b.x) / 2, 0.049, (a.z + b.z) / 2]} rotation={[0, -angle, 0]} receiveShadow>
      <boxGeometry args={[length, 0.035, Math.max(0.045, widthMm * scale)]} />
      <meshStandardMaterial color="#d99a2b" metalness={0.55} roughness={0.34} />
    </mesh>
  );
}

export function PCBModel({ geometry }: Props) {
  const mapped = useMemo(() => boardScale(geometry.board), [geometry.board]);

  return (
    <group>
      <RoundedBox
        args={[mapped.width, mapped.thickness, mapped.depth]}
        radius={0.035}
        smoothness={5}
        position={[0, -mapped.thickness / 2, 0]}
        receiveShadow
      >
        <meshStandardMaterial color="#17452f" roughness={0.78} />
      </RoundedBox>

      <mesh position={[0, 0.012, 0]} receiveShadow>
        <boxGeometry args={[mapped.width - 0.08, 0.026, mapped.depth - 0.08]} />
        <meshStandardMaterial color="#bd7f22" metalness={0.5} roughness={0.32} />
      </mesh>

      <gridHelper args={[Math.max(mapped.width, mapped.depth), 16, "#2e6a4b", "#24533c"]} position={[0, 0.004, 0]} />

      {geometry.traces.map((trace) =>
        trace.points.slice(0, -1).map((point, index) => (
          <TraceStrip
            key={`${trace.id}-${index}`}
            start={point}
            end={trace.points[index + 1]}
            widthMm={trace.width_mm}
            geometry={geometry}
          />
        ))
      )}

      {geometry.pads.map((pad) => {
        const center = toWorld({ ...pad.center, z: 0.06 }, geometry.board);
        return (
          <group key={pad.id} position={[center.x, 0.066, center.z]}>
            <Cylinder args={[pad.radius_mm * mapped.scale, pad.radius_mm * mapped.scale, 0.038, 48]}>
              <meshStandardMaterial color="#e0a83a" metalness={0.6} roughness={0.3} />
            </Cylinder>
            <Cylinder args={[pad.drill_radius_mm * mapped.scale, pad.drill_radius_mm * mapped.scale, 0.044, 32]}>
              <meshStandardMaterial color="#071013" roughness={0.5} />
            </Cylinder>
          </group>
        );
      })}

      {geometry.faults.map((fault) => {
        if (!fault.location) {
          return null;
        }
        const position = toWorld({ ...fault.location, z: 0.1 }, geometry.board);
        return (
          <mesh key={fault.id} position={[position.x, 0.11, position.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.11, 0.16, 28]} />
            <meshBasicMaterial color="#f05252" side={THREE.DoubleSide} />
          </mesh>
        );
      })}
    </group>
  );
}
