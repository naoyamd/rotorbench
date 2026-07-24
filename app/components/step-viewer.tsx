"use client";

import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type MeshPayload = {
  meshes: Array<{
    id: string;
    name: string;
    color: number[] | null;
    positions: number[];
    normals: number[] | null;
    indices: number[];
  }>;
};

function createGeometry(payload: MeshPayload) {
  const group = new Group();
  for (const source of payload.meshes) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(source.positions), 3));
    if (source.normals) geometry.setAttribute("normal", new BufferAttribute(new Float32Array(source.normals), 3));
    else geometry.computeVertexNormals();
    geometry.setIndex(source.indices);
    const color = source.color
      ? new Color(source.color[0], source.color[1], source.color[2])
      : new Color("#8bb7cf");
    group.add(new Mesh(geometry, new MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.62 })));
  }
  return group;
}

export function StepViewer({ meshUrl, label }: { meshUrl: string; label: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const projectionRef = useRef<(() => void) | null>(null);
  const zoomRef = useRef<((factor: number) => void) | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [projection, setProjection] = useState<"perspective" | "orthographic">("perspective");

  useEffect(() => {
    const host = hostRef.current;
    const canvasMount = canvasMountRef.current;
    if (!host || !canvasMount) return;
    let disposed = false;
    let renderer: WebGLRenderer | null = null;
    let cleanup = () => {};

    void fetch(meshUrl)
      .then((response) => {
        if (!response.ok) throw new Error("Mesh asset could not be loaded");
        return response.json() as Promise<MeshPayload>;
      })
      .then((payload) => {
        if (disposed || payload.meshes.length === 0) return;
        const scene = new Scene();
        scene.background = new Color("#101619");
        const model = createGeometry(payload);
        scene.add(model);
        scene.add(new AmbientLight("#d9efff", 1.7));
        const keyLight = new DirectionalLight("#ffffff", 2.6);
        keyLight.position.set(5, 8, 9);
        scene.add(keyLight);

        const width = Math.max(host.clientWidth, 1);
        const height = Math.max(host.clientHeight, 1);
        renderer = new WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, height);
        const canvas = renderer.domElement;
        canvasMount.appendChild(canvas);

        const perspective = new PerspectiveCamera(42, width / height, 0.01, 100000);
        const orthographic = new OrthographicCamera(-1, 1, 1, -1, 0.01, 100000);
        let activeCamera: PerspectiveCamera | OrthographicCamera = perspective;
        const controls = new OrbitControls<PerspectiveCamera | OrthographicCamera>(activeCamera, renderer.domElement);
        controls.enableDamping = true;
        controls.screenSpacePanning = true;

        const bounds = new Box3().setFromObject(model);
        const center = new Vector3();
        const size = new Vector3();
        bounds.getCenter(center);
        bounds.getSize(size);
        const radius = Math.max(size.length() * 0.65, 1);
        const fit = () => {
          perspective.position.set(center.x + radius * 1.6, center.y + radius * 1.15, center.z + radius * 1.6);
          perspective.near = radius / 1000;
          perspective.far = radius * 1000;
          perspective.updateProjectionMatrix();
          const aspect = Math.max(host.clientWidth / Math.max(host.clientHeight, 1), 0.1);
          orthographic.left = -radius * aspect;
          orthographic.right = radius * aspect;
          orthographic.top = radius;
          orthographic.bottom = -radius;
          orthographic.position.copy(perspective.position);
          orthographic.near = perspective.near;
          orthographic.far = perspective.far;
          orthographic.zoom = 1;
          orthographic.updateProjectionMatrix();
          controls.target.copy(center);
          controls.update();
        };
        const switchProjection = () => {
          activeCamera = activeCamera === perspective ? orthographic : perspective;
          controls.object = activeCamera;
          controls.update();
          setProjection(activeCamera === perspective ? "perspective" : "orthographic");
        };
        const zoom = (factor: number) => {
          if (activeCamera === perspective) {
            const offset = perspective.position.clone().sub(controls.target).multiplyScalar(factor);
            perspective.position.copy(controls.target).add(offset);
          } else {
            orthographic.zoom = Math.min(100, Math.max(0.01, orthographic.zoom / factor));
            orthographic.updateProjectionMatrix();
          }
          controls.update();
        };
        fitRef.current = fit;
        projectionRef.current = switchProjection;
        zoomRef.current = zoom;
        fit();

        let animation = 0;
        const render = () => {
          controls.update();
          renderer?.render(scene, activeCamera);
          animation = window.requestAnimationFrame(render);
        };
        render();
        const resize = () => {
          const nextWidth = Math.max(host.clientWidth, 1);
          const nextHeight = Math.max(host.clientHeight, 1);
          renderer?.setSize(nextWidth, nextHeight);
          perspective.aspect = nextWidth / nextHeight;
          perspective.updateProjectionMatrix();
          fit();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(host);
        cleanup = () => {
          window.cancelAnimationFrame(animation);
          observer.disconnect();
          controls.dispose();
          model.traverse((object) => {
            if (object instanceof Mesh) {
              object.geometry.dispose();
              (object.material as MeshStandardMaterial).dispose();
            }
          });
          if (canvas.parentNode === canvasMount) canvasMount.removeChild(canvas);
          renderer?.dispose();
        };
        setState("ready");
      })
      .catch(() => setState("error"));

    return () => {
      disposed = true;
      fitRef.current = null;
      projectionRef.current = null;
      zoomRef.current = null;
      cleanup();
    };
  }, [meshUrl]);

  return (
    <section className="viewer" aria-label={`${label} preprocessed 3D view`}>
      <div className="viewer-toolbar">
        <span>PREPROCESSED MESH</span>
        <div>
          <button type="button" onClick={() => fitRef.current?.()}>FIT (F)</button>
          <button type="button" onClick={() => projectionRef.current?.()}>PROJECTION: {projection.toUpperCase()} (P)</button>
        </div>
      </div>
      <div
        className="viewer-canvas"
        ref={hostRef}
        tabIndex={0}
        role="application"
        aria-label={`${label}: drag to orbit, right-drag to pan, wheel to zoom. Press F to fit, P to change projection, plus to zoom in, or minus to zoom out.`}
        onKeyDown={(event) => {
          const key = event.key.toLowerCase();
          if (key === "f") fitRef.current?.();
          else if (key === "p") projectionRef.current?.();
          else if (key === "+" || key === "=") zoomRef.current?.(0.8);
          else if (key === "-" || key === "_") zoomRef.current?.(1.25);
          else return;
          event.preventDefault();
        }}
      >
        <div className="viewer-canvas-mount" ref={canvasMountRef} aria-hidden="true" />
        {state === "loading" ? <p>Preparing display mesh…</p> : null}
        {state === "error" ? <p role="status">The preprocessed mesh is unavailable. Download the original STEP file below.</p> : null}
      </div>
      <p className="viewer-help">Orbit: drag · Pan: right-drag · Zoom: wheel/pinch or +/− · Keyboard: F fit, P projection</p>
    </section>
  );
}
