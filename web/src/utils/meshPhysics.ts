import { AgentNode, MeshEdge } from '../types';

export interface NodePoint extends AgentNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export class ForceDirectedMesh {
  nodes: NodePoint[] = [];
  edges: MeshEdge[] = [];
  width: number = 800;
  height: number = 600;
  selectedNodeId: string | null = null;
  hoveredNodeId: string | null = null;
  draggedNode: NodePoint | null = null;
  panX: number = 0;
  panY: number = 0;
  zoom: number = 1;
  animFrameId: number | null = null;
  canvas: HTMLCanvasElement | null = null;
  ctx: CanvasRenderingContext2D | null = null;
  onSelectNode?: (node: AgentNode) => void;
  particleOffset: number = 0;

  constructor(
    agents: AgentNode[],
    edges: MeshEdge[],
    onSelect?: (node: AgentNode) => void
  ) {
    this.edges = [...edges];
    this.onSelectNode = onSelect;
    this.initNodes(agents);
  }

  initNodes(agents: AgentNode[]) {
    const total = agents.length;
    this.nodes = agents.map((agent, i) => {
      // Position scarlet.ai in center, others in balanced spiral layout
      let x = 0;
      let y = 0;
      if (agent.isGenesis) {
        x = 0;
        y = 0;
      } else {
        const angle = (i / total) * Math.PI * 2 * 3;
        const dist = 120 + (i * 11);
        x = Math.cos(angle) * dist;
        y = Math.sin(angle) * dist;
      }
      return {
        ...agent,
        x,
        y,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        radius: agent.isGenesis ? 20 : 12,
      };
    });
  }

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    this.bindEvents();
    this.start();
  }

  detach() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    if (this.ctx) {
      this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
  }

  updatePhysics() {
    const repulsion = 1400;
    const centerGravity = 0.02;
    const springLength = 110;
    const springK = 0.04;
    const damping = 0.88;

    // Repulsion between all pairs
    for (let i = 0; i < this.nodes.length; i++) {
      const nodeA = this.nodes[i];
      for (let j = i + 1; j < this.nodes.length; j++) {
        const nodeB = this.nodes[j];
        const dx = nodeB.x - nodeA.x;
        const dy = nodeB.y - nodeA.y;
        const distSq = dx * dx + dy * dy + 100;
        const dist = Math.sqrt(distSq);
        const force = repulsion / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (nodeA !== this.draggedNode && !nodeA.isGenesis) {
          nodeA.vx -= fx;
          nodeA.vy -= fy;
        }
        if (nodeB !== this.draggedNode && !nodeB.isGenesis) {
          nodeB.vx += fx;
          nodeB.vy += fy;
        }
      }

      // Center gravity
      if (nodeA !== this.draggedNode && !nodeA.isGenesis) {
        nodeA.vx -= nodeA.x * centerGravity;
        nodeA.vy -= nodeA.y * centerGravity;
      }
    }

    // Spring tension for edges
    for (const edge of this.edges) {
      const nodeA = this.nodes.find((n) => n.tokenId === edge.fromTokenId);
      const nodeB = this.nodes.find((n) => n.tokenId === edge.toTokenId);
      if (!nodeA || !nodeB) continue;

      const dx = nodeB.x - nodeA.x;
      const dy = nodeB.y - nodeA.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const displacement = dist - springLength;
      const springForce = displacement * springK;

      const fx = (dx / dist) * springForce;
      const fy = (dy / dist) * springForce;

      if (nodeA !== this.draggedNode && !nodeA.isGenesis) {
        nodeA.vx += fx;
        nodeA.vy += fy;
      }
      if (nodeB !== this.draggedNode && !nodeB.isGenesis) {
        nodeB.vx -= fx;
        nodeB.vy -= fy;
      }
    }

    // Apply velocities
    for (const node of this.nodes) {
      if (node === this.draggedNode) continue;
      if (node.isGenesis) {
        node.x = 0;
        node.y = 0;
        continue;
      }
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;
    }

    this.particleOffset = (this.particleOffset + 0.015) % 1;
  }

  render() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const cx = this.width / 2 + this.panX;
    const cy = this.height / 2 + this.panY;

    ctx.clearRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(this.zoom, this.zoom);

    // 1. Draw Edges
    for (const edge of this.edges) {
      const nodeA = this.nodes.find((n) => n.tokenId === edge.fromTokenId);
      const nodeB = this.nodes.find((n) => n.tokenId === edge.toTokenId);
      if (!nodeA || !nodeB) continue;

      const isConnectedToHovered =
        this.hoveredNodeId &&
        (nodeA.id === this.hoveredNodeId || nodeB.id === this.hoveredNodeId);

      const isConnectedToSelected =
        this.selectedNodeId &&
        (nodeA.id === this.selectedNodeId || nodeB.id === this.selectedNodeId);

      ctx.beginPath();
      ctx.moveTo(nodeA.x, nodeA.y);
      ctx.lineTo(nodeB.x, nodeB.y);

      if (edge.isMutual) {
        // Glowing Golden Reciprocal Edge
        ctx.strokeStyle = isConnectedToHovered || isConnectedToSelected
          ? 'rgba(251, 191, 36, 1)'
          : 'rgba(245, 158, 11, 0.45)';
        ctx.lineWidth = isConnectedToHovered || isConnectedToSelected ? 3 : 1.6;
        ctx.shadowColor = 'rgba(245, 158, 11, 0.6)';
        ctx.shadowBlur = isConnectedToHovered || isConnectedToSelected ? 12 : 5;
        ctx.stroke();

        // Animated Energy Particle along mutual handshake
        const hashSeed = Number(BigInt(edge.fromTokenId || 0) % 1000n);
        const pT = (this.particleOffset + (hashSeed * 0.13)) % 1;
        const px = nodeA.x + (nodeB.x - nodeA.x) * pT;
        const py = nodeA.y + (nodeB.y - nodeA.y) * pT;
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fef08a';
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 8;
        ctx.fill();
      } else {
        // Cyan Dotted Pending Ping
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.5)';
        ctx.lineWidth = 1;
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 2. Draw Nodes
    for (const node of this.nodes) {
      const isHovered = this.hoveredNodeId === node.id;
      const isSelected = this.selectedNodeId === node.id;

      ctx.save();
      ctx.translate(node.x, node.y);

      if (node.isGenesis) {
        // scarlet.ai Genesis Node Special Aura
        const pulse = Math.sin(Date.now() * 0.003) * 4;
        const auraGrad = ctx.createRadialGradient(0, 0, 8, 0, 0, 36 + pulse);
        auraGrad.addColorStop(0, 'rgba(244, 63, 94, 0.9)');
        auraGrad.addColorStop(0.4, 'rgba(225, 29, 72, 0.4)');
        auraGrad.addColorStop(1, 'rgba(225, 29, 72, 0)');
        ctx.fillStyle = auraGrad;
        ctx.beginPath();
        ctx.arc(0, 0, 36 + pulse, 0, Math.PI * 2);
        ctx.fill();

        // Rotating outer ring
        ctx.beginPath();
        ctx.arc(0, 0, 24, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Core orb
        ctx.beginPath();
        ctx.arc(0, 0, 16, 0, Math.PI * 2);
        ctx.fillStyle = '#e11d48';
        ctx.shadowColor = '#f43f5e';
        ctx.shadowBlur = 18;
        ctx.fill();
      } else {
        // Standard Verified Agent Node
        const r = node.radius + (isHovered || isSelected ? 4 : 0);

        // Glow ring
        ctx.beginPath();
        ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = isSelected
          ? 'rgba(251, 191, 36, 0.9)'
          : isHovered
          ? 'rgba(0, 240, 255, 0.9)'
          : 'rgba(6, 182, 212, 0.3)';
        ctx.lineWidth = isSelected || isHovered ? 2.5 : 1;
        ctx.shadowColor = isSelected ? '#fbbf24' : '#00f0ff';
        ctx.shadowBlur = isHovered || isSelected ? 14 : 4;
        ctx.stroke();

        // Node fill
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? '#fbbf24' : isHovered ? '#00f0ff' : '#0f172a';
        ctx.fill();
      }

      // Label below node
      ctx.shadowBlur = 0;
      ctx.font = node.isGenesis ? 'bold 12px "JetBrains Mono"' : '10px "JetBrains Mono"';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = node.isGenesis
        ? '#fda4af'
        : isSelected
        ? '#fbbf24'
        : isHovered
        ? '#ffffff'
        : '#94a3b8';
      ctx.fillText(node.name, 0, (node.isGenesis ? 28 : node.radius + 6));

      // Token ID sub-label
      ctx.font = '8px "JetBrains Mono"';
      ctx.fillStyle = '#64748b';
      ctx.fillText(`#${node.tokenId}`, 0, (node.isGenesis ? 42 : node.radius + 19));

      ctx.restore();
    }

    ctx.restore();
  }

  start() {
    const loop = () => {
      this.updatePhysics();
      this.render();
      this.animFrameId = requestAnimationFrame(loop);
    };
    loop();
  }

  screenToWorld(sx: number, sy: number) {
    const cx = this.width / 2 + this.panX;
    const cy = this.height / 2 + this.panY;
    const wx = (sx - cx) / this.zoom;
    const wy = (sy - cy) / this.zoom;
    return { wx, wy };
  }

  findNodeAt(sx: number, sy: number): NodePoint | null {
    const { wx, wy } = this.screenToWorld(sx, sy);
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      const dx = wx - node.x;
      const dy = wy - node.y;
      const hitRadius = (node.radius + 10) * 1.2;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return node;
      }
    }
    return null;
  }

  bindEvents() {
    if (!this.canvas) return;
    const canvas = this.canvas;
    let isMouseDown = false;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      isMouseDown = true;
      lastX = sx;
      lastY = sy;

      const hit = this.findNodeAt(sx, sy);
      if (hit) {
        this.draggedNode = hit;
        this.selectedNodeId = hit.id;
        if (this.onSelectNode) this.onSelectNode(hit);
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (this.draggedNode) {
        const { wx, wy } = this.screenToWorld(sx, sy);
        this.draggedNode.x = wx;
        this.draggedNode.y = wy;
        this.draggedNode.vx = 0;
        this.draggedNode.vy = 0;
      } else if (isMouseDown) {
        const dx = sx - lastX;
        const dy = sy - lastY;
        this.panX += dx;
        this.panY += dy;
        lastX = sx;
        lastY = sy;
      } else {
        const hit = this.findNodeAt(sx, sy);
        this.hoveredNodeId = hit ? hit.id : null;
        canvas.style.cursor = hit ? 'pointer' : 'grab';
      }
    });

    window.addEventListener('mouseup', () => {
      isMouseDown = false;
      this.draggedNode = null;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      this.zoom = Math.max(0.4, Math.min(3.5, this.zoom * zoomFactor));
    }, { passive: false });
  }

  // Add ping handshake edge dynamically
  addHandshake(fromId: number | string, toId: number | string) {
    const fromAgent = this.nodes.find((n) => n.tokenId.toString() === fromId.toString());
    const toAgent = this.nodes.find((n) => n.tokenId.toString() === toId.toString());
    if (!fromAgent || !toAgent) return;

    const existing = this.edges.find(
      (e) =>
        (e.fromTokenId.toString() === fromId.toString() && e.toTokenId.toString() === toId.toString()) ||
        (e.fromTokenId.toString() === toId.toString() && e.toTokenId.toString() === fromId.toString())
    );

    if (existing) {
      existing.isMutual = true;
    } else {
      this.edges.push({
        fromTokenId: fromId,
        toTokenId: toId,
        fromName: fromAgent.name,
        toName: toAgent.name,
        edgeKey: `${BigInt(fromId) < BigInt(toId) ? fromId : toId}_${BigInt(fromId) < BigInt(toId) ? toId : fromId}`,
        isMutual: true,
        establishedAt: Date.now(),
        capabilityMask: (fromAgent.capabilities & toAgent.capabilities) || 1,
      });
    }
  }
}
