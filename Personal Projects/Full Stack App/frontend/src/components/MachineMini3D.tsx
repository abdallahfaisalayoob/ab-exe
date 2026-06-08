import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useSimulatorStore } from "../store/simulatorStore";

export function MachineMini3D() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const toolRef = useRef<THREE.Mesh | null>(null);
  const gantryRef = useRef<THREE.Group | null>(null);
  const frame = useSimulatorStore((state) => state.currentFrame());
  const project = useSimulatorStore((state) => state.project);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }
    const width = mount.clientWidth;
    const height = mount.clientHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#101519");
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(88, 92, 110);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const light = new THREE.DirectionalLight("#ffffff", 2.1);
    light.position.set(20, 60, 40);
    scene.add(light);
    scene.add(new THREE.AmbientLight("#8fb4c5", 0.8));

    const board = new THREE.Mesh(
      new THREE.BoxGeometry(72, 48, 2),
      new THREE.MeshStandardMaterial({ color: "#17452f", roughness: 0.72 })
    );
    board.position.y = -4;
    scene.add(board);

    const railMaterial = new THREE.MeshStandardMaterial({ color: "#5a6b78", metalness: 0.35, roughness: 0.35 });
    const gantry = new THREE.Group();
    const rail = new THREE.Mesh(new THREE.BoxGeometry(78, 2, 2), railMaterial);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(4, 8, 42), railMaterial);
    bridge.position.y = 9;
    bridge.position.z = 18;
    gantry.add(rail, bridge);
    gantry.position.y = 12;
    scene.add(gantry);
    gantryRef.current = gantry;

    const tool = new THREE.Mesh(
      new THREE.CylinderGeometry(2.5, 1.4, 18, 24),
      new THREE.MeshStandardMaterial({ color: "#31c6df", emissive: "#0b5d67", emissiveIntensity: 0.35 })
    );
    tool.position.y = 12;
    scene.add(tool);
    toolRef.current = tool;

    let animation = 0;
    const render = () => {
      animation = requestAnimationFrame(render);
      renderer.render(scene, camera);
    };
    render();

    return () => {
      cancelAnimationFrame(animation);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      toolRef.current = null;
      gantryRef.current = null;
    };
  }, []);

  useEffect(() => {
    const tool = toolRef.current;
    const gantry = gantryRef.current;
    if (!tool || !gantry || !frame || !project) {
      return;
    }
    const x = (frame.position.x / project.geometry.board.width_mm - 0.5) * 72;
    const z = (frame.position.y / project.geometry.board.height_mm - 0.5) * 48;
    const y = 16 + Math.max(-4, Math.min(8, frame.position.z ?? 0));
    tool.position.set(x, y, z);
    gantry.position.x = x;
    gantry.position.z = z;
  }, [frame, project]);

  return (
    <section className="panel hidden min-h-40 overflow-hidden rounded xl:flex xl:flex-col">
      <div className="border-b border-slate-700/50 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-100">3D Machine</h2>
      </div>
      <div ref={mountRef} className="h-48 w-full" />
    </section>
  );
}
