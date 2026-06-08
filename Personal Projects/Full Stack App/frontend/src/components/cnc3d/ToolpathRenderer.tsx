import { Line } from "@react-three/drei";
import { useMemo } from "react";
import { executedSegments, toWorld } from "../../lib/cnc3d";
import type { EngravingPlan } from "../../lib/engraving";
import type { Geometry, Toolpath } from "../../types/simulator";

interface Props {
  geometry: Geometry;
  toolpath: Toolpath;
  simTimeSec: number;
  engravingPlan: EngravingPlan | null;
  showEngravingPreview: boolean;
}

function modeColor(mode: string) {
  if (mode === "cut") {
    return "#ff4040";
  }
  if (mode === "drill" || mode === "plunge") {
    return "#4da3ff";
  }
  if (mode === "engrave") {
    return "#ffd166";
  }
  return "#f8fafc";
}

export function ToolpathRenderer({ geometry, toolpath, simTimeSec, engravingPlan, showEngravingPreview }: Props) {
  const segments = useMemo(() => executedSegments(toolpath.moves, simTimeSec), [toolpath.moves, simTimeSec]);
  const ghostMoves = useMemo(() => toolpath.moves.filter((move) => move.mode !== "plunge" && move.mode !== "retract"), [toolpath.moves]);

  return (
    <group>
      {ghostMoves.map((move) => {
        const start = toWorld(move.start, geometry.board, 0.2);
        const end = toWorld(move.end, geometry.board, 0.2);
        return (
          <Line
            key={`ghost-${move.id}`}
            points={[
              [start.x, start.y, start.z],
              [end.x, end.y, end.z],
            ]}
            color={modeColor(move.mode)}
            lineWidth={move.mode === "travel" ? 1 : 1.4}
            dashed={move.mode === "travel"}
            dashSize={0.12}
            gapSize={0.1}
            transparent
            opacity={move.mode === "travel" ? 0.16 : 0.22}
          />
        );
      })}

      {segments.map((segment) => {
        const start = toWorld(segment.start, geometry.board, 0.12);
        const end = toWorld(segment.end, geometry.board, 0.12);
        return (
          <Line
            key={segment.id}
            points={[
              [start.x, start.y, start.z],
              [end.x, end.y, end.z],
            ]}
            color={modeColor(segment.mode)}
            lineWidth={segment.mode === "drill" || segment.mode === "plunge" ? 2.6 : segment.mode === "cut" ? 2.3 : 1.4}
            dashed={segment.mode === "travel" || segment.mode === "retract"}
            dashSize={0.12}
            gapSize={0.1}
            transparent
            opacity={segment.mode === "travel" || segment.mode === "retract" ? 0.48 : 0.96}
          />
        );
      })}

      {showEngravingPreview && engravingPlan
        ? engravingPlan.segments.map((segment, index) => {
            const start = toWorld({ ...segment.start, z: 0.16 }, geometry.board);
            const end = toWorld({ ...segment.end, z: 0.16 }, geometry.board);
            return (
              <Line
                key={`engrave-preview-${index}`}
                points={[
                  [start.x, start.y, start.z],
                  [end.x, end.y, end.z],
                ]}
                color="#ffd166"
                lineWidth={1.8}
                dashed
                dashSize={0.08}
                gapSize={0.06}
                transparent
                opacity={0.82}
              />
            );
          })
        : null}
    </group>
  );
}
