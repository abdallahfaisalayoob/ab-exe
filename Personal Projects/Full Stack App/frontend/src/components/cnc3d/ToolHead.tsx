import { Cone, Cylinder } from "@react-three/drei";
import { useMemo } from "react";
import { toWorld } from "../../lib/cnc3d";
import type { BoardBounds, TelemetrySample } from "../../types/simulator";

interface Props {
  board: BoardBounds;
  frame: TelemetrySample | null;
}

export function ToolHead({ board, frame }: Props) {
  const position = useMemo(() => {
    const source = frame?.position ?? { x: 0, y: 0, z: 5 };
    return toWorld(source, board);
  }, [board, frame]);
  const active = frame?.mode === "cut" || frame?.mode === "drill" || frame?.mode === "plunge";

  return (
    <group position={[position.x, position.y, position.z]}>
      <Cylinder args={[0.16, 0.16, 0.62, 32]} position={[0, 0.42, 0]} castShadow>
        <meshStandardMaterial color="#7f91a1" metalness={0.62} roughness={0.28} />
      </Cylinder>
      <Cylinder args={[0.09, 0.12, 0.2, 24]} position={[0, 0.05, 0]} castShadow>
        <meshStandardMaterial color={active ? "#31c6df" : "#d5dde6"} emissive={active ? "#0e5360" : "#000000"} emissiveIntensity={active ? 0.55 : 0} />
      </Cylinder>
      <Cone args={[0.055, 0.24, 24]} position={[0, -0.12, 0]} rotation={[Math.PI, 0, 0]} castShadow>
        <meshStandardMaterial color={active ? "#ff4a4a" : "#cbd5e1"} emissive={active ? "#6f1111" : "#000000"} emissiveIntensity={active ? 0.45 : 0} />
      </Cone>
      <mesh position={[0, -0.23, 0]} visible={active}>
        <sphereGeometry args={[0.09, 20, 20]} />
        <meshBasicMaterial color={frame?.mode === "drill" ? "#4da3ff" : "#ff4646"} transparent opacity={0.45} />
      </mesh>
    </group>
  );
}
