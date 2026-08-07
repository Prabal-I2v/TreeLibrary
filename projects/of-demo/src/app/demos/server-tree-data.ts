import { ServerTreeBackend } from './server-tree-backend';

/**
 * Types matching an analytic-server / video-source tree as it arrives from the API.
 *
 * Three things about this shape drive the tree configuration:
 *  - `children` is null, [] or populated, and null/[] do NOT mean "leaf"
 *  - `isParent` is the authority on whether a node can expand, so a node can advertise
 *    children it has not loaded yet (see the gpu server below)
 *  - `icon` is a path to an image, not a css class
 */
export interface ServerTreeNode {
    id: string;
    resourceId: string;
    name: string;
    children: ServerTreeNode[] | null;
    data: ServerTreeNodeData;
    checked: boolean;
    isParent: boolean;
    nocheck: boolean;
    icon: string;
    title: string;
}

export interface ServerTreeNodeData {
    id: string;
    name: string;
    typeOfNode: 'AnalyticServerCPU' | 'AnalyticServerGPU' | 'VideoSource' | string;
    isDroppable: boolean;
    ip: string;
    type?: number;
    normalizedId?: number;
    featureType?: number;
    otherData?: Record<string, unknown>;
}

/**
 * The payload exactly as supplied. Note every node here has `nocheck: true`, which is why
 * none of them render a checkbox - the generated nodes below use `nocheck: false`.
 */
export const SERVER_TREE_DATA: ServerTreeNode[] = [
    {
        id: 'ebeb7868-173e-466e-b6c7-245473f8a279',
        resourceId: '08def000-5c83-2e2b-b536-02c8e7fe0000',
        name: 'cpu',
        children: [
            {
                id: 'e4831f3f-7049-4dfe-bc75-1f96342033f2',
                resourceId: '08def000-6bff-c269-b536-02c8e7fe0000',
                name: 'mycam',
                children: null,
                data: {
                    id: '08def000-6bff-c269-b536-02c8e7fe0000',
                    name: 'mycam',
                    typeOfNode: 'VideoSource',
                    isDroppable: true,
                    ip: '192.168.5.104',
                    normalizedId: 1,
                    featureType: 1,
                    otherData: {
                        fromConfigNodeId: '377fa781-0d70-4dbd-8b85-37677e33cfe0',
                        fromEntityType: 'VideoSource',
                        ip: '192.168.5.104',
                        normalizedId: 1,
                        featureType: 1
                    }
                },
                checked: false,
                isParent: false,
                nocheck: true,
                icon: 'assets/Outline/camera-bullet.svg',
                title:
                    'ID: 08def000-6bff-c269-b536-02c8e7fe0000\nNormalized ID: 1\nIP: 192.168.5.104\n' +
                    'Attached Server: cpu\nApplied Rules: FRS\nUsing Stream 1\n'
            }
        ],
        data: {
            id: '08def000-5c83-2e2b-b536-02c8e7fe0000',
            name: 'cpu',
            typeOfNode: 'AnalyticServerCPU',
            isDroppable: false,
            ip: '192.168.5.104',
            type: 0,
            otherData: {
                fromConfigNodeId: 'fa0fe914-8047-4cda-8170-403afcf7488f',
                fromEntityType: 'AnalyticServerCPU',
                ip: '192.168.5.104',
                type: 0,
                typeOfNode: 'AnalyticServerCPU'
            }
        },
        checked: false,
        isParent: true,
        nocheck: true,
        icon: 'assets/server-cpu-dissconnected.svg',
        title: 'Name: cpu\nId: 08def000-5c83-2e2b-b536-02c8e7fe0000\nIP: 192.168.5.104\nType: CPU\n'
    },
    {
        id: '35c118c4-512c-4961-8d77-333d46f45e58',
        resourceId: '08def22b-2c32-f004-b536-02c83b810000',
        name: 'gpu',
        children: [],
        data: {
            id: '08def22b-2c32-f004-b536-02c83b810000',
            name: 'gpu',
            typeOfNode: 'AnalyticServerGPU',
            isDroppable: false,
            ip: '192.168.7.58',
            type: 1,
            otherData: {
                fromConfigNodeId: 'e779d9bf-a919-4a70-a729-b0b5591fc422',
                fromEntityType: 'AnalyticServerGPU',
                ip: '192.168.7.58',
                type: 1,
                typeOfNode: 'AnalyticServerGPU'
            }
        },
        checked: false,
        isParent: true,
        nocheck: true,
        icon: 'assets/chip-dissconnected.svg',
        title: 'Name: gpu\nId: 08def22b-2c32-f004-b536-02c83b810000\nIP: 192.168.7.58\nType: GPU\n'
    }
];

/** Total node count the demo generates. */
export const SERVER_TREE_TARGET_NODES = 100_000;

const SUBNETS = ['192.168.5', '192.168.7', '10.20.30', '172.16.4', '10.8.12'];
const RULES = ['FRS', 'LPR', 'Intrusion', 'Loitering', 'CrowdCount', 'ANPR'];

/** Deterministic pseudo-random generator (mulberry32) so the generated tree is reproducible. */
function seededRandom(seed: number) {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function countNodes(nodes: readonly ServerTreeNode[]): number {
    let total = 0;
    for (const node of nodes) {
        total += 1 + countNodes(node.children ?? []);
    }
    return total;
}

/**
 * Scales the sample payload up to `targetNodes` nodes of the same shape. The two original
 * servers are kept verbatim at the top, everything after them is generated.
 *
 * Ids are uuid-shaped and made unique by folding a sequence number into the last group, so
 * every node has a distinct `id`, `resourceId`, `name` and title. Roughly one server in
 * twenty keeps `children: []` on the client while its real children are held by the backend,
 * which is what makes the two search modes meaningfully different.
 */
export function createServerTree(targetNodes = SERVER_TREE_TARGET_NODES): ServerTreeBackend {
    const rand = seededRandom(19042024);
    const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)];
    const hex = (value: number, len: number) => Math.floor(value).toString(16).padStart(len, '0').slice(-len);

    let seq = 0;
    const uid = () =>
        `${hex(rand() * 0xffffffff, 8)}-${hex(rand() * 0xffff, 4)}-${hex(rand() * 0xffff, 4)}-` +
        `${hex(rand() * 0xffff, 4)}-${hex(++seq, 12)}`;

    // The supplied sample, cloned so the demo can mutate it without touching the constant.
    const nodes: ServerTreeNode[] = SERVER_TREE_DATA.map(node => structuredClone(node));
    const hidden = new Map<string, ServerTreeNode[]>();
    const lazyServers: ServerTreeNode[] = [];
    let created = countNodes(nodes);
    let normalizedId = 0;
    let serverIndex = 0;

    // The sample's `gpu` also arrives with children: [] and isParent: true, so give the
    // backend something real to hand back when it is expanded.
    const sampleLazy = nodes.filter(n => n.isParent && Array.isArray(n.children) && n.children.length === 0);

    while (created < targetNodes) {
        const isGpu = serverIndex % 3 === 2;
        const connected = rand() > 0.35;
        const subnet = pick(SUBNETS);
        const serverIp = `${subnet}.${10 + (serverIndex % 240)}`;
        const serverResourceId = uid();
        const serverName = `${isGpu ? 'gpu' : 'cpu'}-${String(serverIndex + 1).padStart(5, '0')}`;

        // Every 20th server keeps its cameras on the backend so the lazy fetch stays
        // demonstrable. They still count towards the total - they just are not client-side yet.
        const lazy = serverIndex % 20 === 19;
        const room = targetNodes - created - 1;
        const cameraCount = Math.max(0, Math.min(8 + Math.floor(rand() * 33), room));

        const children: ServerTreeNode[] = [];
        for (let c = 0; c < cameraCount; c++) {
            const camResourceId = uid();
            const camName = `${serverName}-cam-${String(c + 1).padStart(2, '0')}`;
            const camIp = `${subnet}.${10 + (serverIndex % 240)}`;
            const rule = pick(RULES);
            normalizedId++;

            children.push({
                id: uid(),
                resourceId: camResourceId,
                name: camName,
                children: null,
                data: {
                    id: camResourceId,
                    name: camName,
                    typeOfNode: 'VideoSource',
                    isDroppable: true,
                    ip: camIp,
                    normalizedId,
                    featureType: 1 + (c % 3),
                    otherData: {
                        fromConfigNodeId: uid(),
                        fromEntityType: 'VideoSource',
                        ip: camIp,
                        normalizedId,
                        featureType: 1 + (c % 3)
                    }
                },
                checked: false,
                isParent: false,
                nocheck: false,
                icon: 'assets/Outline/camera-bullet.svg',
                title:
                    `ID: ${camResourceId}\nNormalized ID: ${normalizedId}\nIP: ${camIp}\n` +
                    `Attached Server: ${serverName}\nApplied Rules: ${rule}\nUsing Stream ${1 + (c % 2)}\n`
            });
        }

        const server: ServerTreeNode = {
            id: uid(),
            resourceId: serverResourceId,
            name: serverName,
            children: lazy ? [] : children,
            data: {
                id: serverResourceId,
                name: serverName,
                typeOfNode: isGpu ? 'AnalyticServerGPU' : 'AnalyticServerCPU',
                isDroppable: false,
                ip: serverIp,
                type: isGpu ? 1 : 0,
                otherData: {
                    fromConfigNodeId: uid(),
                    fromEntityType: isGpu ? 'AnalyticServerGPU' : 'AnalyticServerCPU',
                    ip: serverIp,
                    type: isGpu ? 1 : 0,
                    typeOfNode: isGpu ? 'AnalyticServerGPU' : 'AnalyticServerCPU'
                }
            },
            checked: false,
            isParent: true,
            nocheck: false,
            icon: isGpu
                ? connected
                    ? 'assets/chip-connected.svg'
                    : 'assets/chip-dissconnected.svg'
                : connected
                  ? 'assets/server-cpu-connected.svg'
                  : 'assets/server-cpu-dissconnected.svg',
            title:
                `Name: ${serverName}\nId: ${serverResourceId}\nIP: ${serverIp}\n` +
                `Type: ${isGpu ? 'GPU' : 'CPU'}\nStatus: ${connected ? 'Connected' : 'Disconnected'}\n`
        };

        nodes.push(server);
        if (lazy) {
            hidden.set(server.id, children);
            lazyServers.push(server);
        }

        created += 1 + children.length;
        serverIndex++;
    }

    // Give the sample's own lazy server (gpu) a set of hidden cameras too.
    for (const server of sampleLazy) {
        const children: ServerTreeNode[] = [];
        for (let c = 0; c < 4; c++) {
            const camResourceId = uid();
            const camName = `${server.name}-cam-${String(c + 1).padStart(2, '0')}`;
            normalizedId++;
            children.push({
                id: uid(),
                resourceId: camResourceId,
                name: camName,
                children: null,
                data: {
                    id: camResourceId,
                    name: camName,
                    typeOfNode: 'VideoSource',
                    isDroppable: true,
                    ip: server.data.ip,
                    normalizedId,
                    featureType: 1
                },
                checked: false,
                isParent: false,
                nocheck: false,
                icon: 'assets/Outline/camera-bullet.svg',
                title: `ID: ${camResourceId}\nNormalized ID: ${normalizedId}\nIP: ${server.data.ip}\nAttached Server: ${server.name}\n`
            });
        }
        hidden.set(server.id, children);
        lazyServers.push(server);
    }

    return new ServerTreeBackend(nodes, hidden, lazyServers);
}

// Fetching a lazy server's children is now ServerTreeBackend.fetchChildren, so that the
// authoritative data lives in one place and server-side search can see it too.
