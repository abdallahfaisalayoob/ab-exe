import { Box, Line } from "@react-three/drei";
import { boardScale } from "../../lib/cnc3d";
import type { BoardBounds } from "../../types/simulator";

interface Props {
  board: BoardBounds;
}

export function MachineFrame({ board }: Props) {
  const mapped = boardScale(board);
  const railY = 0.92;
  const width = mapped.width + 1.2;
  const depth = mapped.depth + 1.0;
  const cornerY = 0.2;
  const corners: [number, number, number][] = [
    [-width / 2, cornerY, -depth / 2],
    [width / 2, cornerY, -depth / 2],
    [width / 2, cornerY, depth / 2],
    [-width / 2, cornerY, depth / 2],
  ];

  return (
    <group>
      <Line points={[...corners, corners[0]]} color="#5a6b78" lineWidth={1.5} transparent opacity={0.75} />
      <Box args={[width, 0.045, 0.06]} position={[0, railY, -depth / 2]} castShadow>
        <meshStandardMaterial color="#5a6b78" metalness={0.35} roughness={0.35} />
      </Box>
      <Box args={[width, 0.045, 0.06]} position={[0, railY, depth / 2]} castShadow>
        <meshStandardMaterial color="#5a6b78" metalness={0.35} roughness={0.35} />
      </Box>
      <Box args={[0.06, 0.045, depth]} position={[-width / 2, 0.32, 0]} castShadow>
        <meshStandardMaterial color="#3d4d58" metalness={0.35} roughness={0.4} />
      </Box>
      <Box args={[0.06, 0.045, depth]} position={[width / 2, 0.32, 0]} castShadow>
        <meshStandardMaterial color="#3d4d58" metalness={0.35} roughness={0.4} />
      </Box>
      <Box args={[0.08, 1.4, 0.08]} position={[-width / 2, 0.58, -depth / 2]} castShadow>
        <meshStandardMaterial color="#4f606d" metalness={0.25} roughness={0.42} />
      </Box>
      <Box args={[0.08, 1.4, 0.08]} position={[width / 2, 0.58, -depth / 2]} castShadow>
        <meshStandardMaterial color="#4f606d" metalness={0.25} roughness={0.42} />
      </Box>
      <Box args={[0.08, 1.4, 0.08]} position={[-width / 2, 0.58, depth / 2]} castShadow>
        <meshStandardMaterial color="#4f606d" metalness={0.25} roughness={0.42} />
      </Box>
      <Box args={[0.08, 1.4, 0.08]} position={[width / 2, 0.58, depth / 2]} castShadow>
        <meshStandardMaterial color="#4f606d" metalness={0.25} roughness={0.42} />
      </Box>
    </group>
  );
}
