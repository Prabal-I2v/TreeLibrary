import { TreeBackend } from './tree-backend';

/**
 * Mutable per-node client state, grouped so that "what the node is" and "what the client is
 * currently doing to it" do not share a namespace. Everything in here is written by the page
 * and only read by the row, which is how the row derives its own appearance rather than being
 * handed inputs that restate it.
 *
 * `nocheck` deliberately stays out: it is a server-declared capability that never changes
 * after load, so it belongs beside `isParent`, not with state that mutates.
 */
export interface NodeUIState {
    /** Initial value comes from the payload; the client owns it from load onward. */
    checked: boolean;
    /** Set while this node's children are being fetched. */
    loading: boolean;
}

/**
 * A tree node as it arrives from the API, plus the client's own `NodeUIState`. Domain-neutral
 * on purpose: the structural fields live here, and anything specific to what a node
 * represents goes in `data`.
 *
 * Three things about this shape drive the tree configuration:
 *  - `children` is null, [] or populated, and null/[] do NOT mean "leaf"
 *  - `isParent` is the authority on whether a node can expand, so a node can advertise
 *    children it has not loaded yet
 *  - `icon` is a path to an image, not a css class
 */
export interface TreeDataModel<TData = TreeData> {
    id: string;
    resourceId: string;
    name: string;
    children: TreeDataModel<TData>[] | null;
    data: TData;
    isParent: boolean;
    nocheck: boolean;
    icon: string;
    title: string;
    NodeUIState: NodeUIState;
}

/**
 * The domain payload carried by a node. Swap this type (or pass your own through
 * `TreeDataModel<T>`) without touching the structural fields above.
 */
export interface TreeData {
    id: string;
    name: string;
    typeOfNode: string;
    isDroppable: boolean;
    ip: string;
    type?: number;
    normalizedId?: number;
    featureType?: number;
    otherData?: Record<string, unknown>;
}

/**
 * Every already-loaded node beneath `item`, depth first. Children that have not been fetched
 * are `null` and are simply not walked, so this only ever reports what the client can see.
 */
export function loadedDescendants(item: TreeDataModel): TreeDataModel[] {
    const result: TreeDataModel[] = [];
    const walk = (nodes: TreeDataModel[] | null) => {
        for (const child of nodes ?? []) {
            result.push(child);
            walk(child.children);
        }
    };
    walk(item.children);
    return result;
}

/**
 * True when some, but not all, loaded descendants are checked - a pure function of the
 * subtree, which is why the row derives it rather than taking it as an input.
 */
export function isPartiallyChecked(item: TreeDataModel): boolean {
    const descendants = loadedDescendants(item);
    if (!descendants.length) {
        return false;
    }
    const checked = descendants.filter(descendant => descendant.NodeUIState.checked).length;
    return checked > 0 && checked < descendants.length;
}

/**
 * The payload as supplied, with the client's own `NodeUIState` attached - the API sends the
 * initial `checked` value but knows nothing about `loading`. Note every node here has
 * `nocheck: true`, which is why none of them render a checkbox - the generated nodes below
 * use `nocheck: false`.
 */
export const SAMPLE_TREE_DATA: TreeDataModel[] = [
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
                NodeUIState: { checked: false, loading: false },
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
        NodeUIState: { checked: false, loading: false },
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
        NodeUIState: { checked: false, loading: false },
        isParent: true,
        nocheck: true,
        icon: 'assets/chip-dissconnected.svg',
        title: 'Name: gpu\nId: 08def22b-2c32-f004-b536-02c83b810000\nIP: 192.168.7.58\nType: GPU\n'
    }
];

/** Total node count the demo generates. */
export const TREE_TARGET_NODES = 100_000;

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

function countNodes(nodes: readonly TreeDataModel[]): number {
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
export function createTreeData(targetNodes = TREE_TARGET_NODES): TreeBackend {
    const rand = seededRandom(19042024);
    const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)];
    const hex = (value: number, len: number) => Math.floor(value).toString(16).padStart(len, '0').slice(-len);

    let seq = 0;
    const uid = () =>
        `${hex(rand() * 0xffffffff, 8)}-${hex(rand() * 0xffff, 4)}-${hex(rand() * 0xffff, 4)}-` +
        `${hex(rand() * 0xffff, 4)}-${hex(++seq, 12)}`;

    // The supplied sample, cloned so the demo can mutate it without touching the constant.
    const nodes: TreeDataModel[] = SAMPLE_TREE_DATA.map(node => structuredClone(node));
    const hidden = new Map<string, TreeDataModel[]>();
    const lazyServers: TreeDataModel[] = [];
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

        // Every 20th server keeps its subtree on the backend so the lazy fetch stays
        // demonstrable. It still counts towards the total - it just is not client-side yet.
        const lazy = serverIndex % 20 === 19;
        const ip = `${subnet}.${10 + (serverIndex % 240)}`;

        // Descendants this server may still create before the target is reached.
        let made = 0;
        const budget = () => targetNodes - created - 1 - made;

        const makeCamera = (name: string, attachedTo: string, index: number): TreeDataModel => {
            const camResourceId = uid();
            const rule = pick(RULES);
            normalizedId++;
            made++;

            return {
                id: uid(),
                resourceId: camResourceId,
                name,
                children: null,
                data: {
                    id: camResourceId,
                    name,
                    typeOfNode: 'VideoSource',
                    isDroppable: true,
                    ip,
                    normalizedId,
                    featureType: 1 + (index % 3),
                    otherData: {
                        fromConfigNodeId: uid(),
                        fromEntityType: 'VideoSource',
                        ip,
                        normalizedId,
                        featureType: 1 + (index % 3)
                    }
                },
                NodeUIState: { checked: false, loading: false },
                isParent: false,
                nocheck: false,
                icon: 'assets/Outline/camera-bullet.svg',
                title:
                    `ID: ${camResourceId}\nNormalized ID: ${normalizedId}\nIP: ${ip}\n` +
                    `Attached Server: ${serverName}\nAttached To: ${attachedTo}\n` +
                    `Applied Rules: ${rule}\nUsing Stream ${1 + (index % 2)}\n`
            };
        };

        const children: TreeDataModel[] = [];

        if (isGpu) {
            // GPU servers run their cameras through analytic pipelines, giving a third level:
            // server -> pipeline -> camera.
            const pipelineCount = 2 + Math.floor(rand() * 3);

            for (let p = 0; p < pipelineCount && budget() > 0; p++) {
                const pipeResourceId = uid();
                const pipeName = `${serverName}-pipe-${String(p + 1).padStart(2, '0')}`;
                const rule = pick(RULES);
                made++; // the pipeline node itself

                const wanted = 4 + Math.floor(rand() * 9);
                const camCount = Math.max(0, Math.min(wanted, budget()));
                const pipeCameras: TreeDataModel[] = [];
                for (let c = 0; c < camCount; c++) {
                    pipeCameras.push(makeCamera(`${pipeName}-cam-${String(c + 1).padStart(2, '0')}`, pipeName, c));
                }

                children.push({
                    id: uid(),
                    resourceId: pipeResourceId,
                    name: pipeName,
                    children: pipeCameras,
                    data: {
                        id: pipeResourceId,
                        name: pipeName,
                        typeOfNode: 'Pipeline',
                        isDroppable: true,
                        ip,
                        type: p,
                        otherData: {
                            fromConfigNodeId: uid(),
                            fromEntityType: 'Pipeline',
                            ip,
                            attachedServer: serverName,
                            rule
                        }
                    },
                    NodeUIState: { checked: false, loading: false },
                    isParent: true,
                    nocheck: false,
                    icon: 'assets/Outline/pipeline.svg',
                    title:
                        `Name: ${pipeName}\nId: ${pipeResourceId}\nAttached Server: ${serverName}\n` +
                        `IP: ${ip}\nRule: ${rule}\nSources: ${camCount}\n`
                });
            }
        } else {
            // CPU servers attach cameras directly.
            const wanted = 8 + Math.floor(rand() * 33);
            const camCount = Math.max(0, Math.min(wanted, budget()));
            for (let c = 0; c < camCount; c++) {
                children.push(makeCamera(`${serverName}-cam-${String(c + 1).padStart(2, '0')}`, serverName, c));
            }
        }

        const server: TreeDataModel = {
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
            NodeUIState: { checked: false, loading: false },
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

        // `made` counts the whole subtree, which children.length no longer does now that
        // GPU servers nest cameras underneath pipelines.
        created += 1 + made;
        serverIndex++;
    }

    // Give the sample's own lazy server (gpu) a set of hidden cameras too.
    for (const server of sampleLazy) {
        const children: TreeDataModel[] = [];
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
                NodeUIState: { checked: false, loading: false },
                isParent: false,
                nocheck: false,
                icon: 'assets/Outline/camera-bullet.svg',
                title: `ID: ${camResourceId}\nNormalized ID: ${normalizedId}\nIP: ${server.data.ip}\nAttached Server: ${server.name}\n`
            });
        }
        hidden.set(server.id, children);
        lazyServers.push(server);
    }

    return new TreeBackend(nodes, hidden, lazyServers);
}

// Fetching a lazy server's children is now TreeBackend.fetchChildren, so that the
// authoritative data lives in one place and server-side search can see it too.
