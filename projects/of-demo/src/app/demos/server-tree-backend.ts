import { ServerTreeNode } from './server-tree-data';

/** Simulated network latency for the stub API. */
const FETCH_LATENCY_MS = 250;
const SEARCH_LATENCY_MS = 300;

export interface ServerSearchResult {
    /** Ids of every node that matched, including nodes the client has not loaded. */
    matchIds: Set<string>;
    /** Lazy servers the client must load before it can show all of those matches. */
    serversToLoad: ServerTreeNode[];
    /** How many matches the server found in total. */
    total: number;
    /** How many of those are behind nodes the client had not loaded. */
    hiddenMatches: number;
}

/**
 * Stands in for the API. It owns the authoritative data set - including the children of lazy
 * servers, which the client has not fetched - so it can answer questions the client cannot.
 */
export class ServerTreeBackend {
    /** Children of lazy servers, keyed by server id. The client does not have these yet. */
    private readonly hidden: Map<string, ServerTreeNode[]>;
    /** Flat view of every node in existence, loaded or not. */
    private readonly allNodes: ServerTreeNode[];
    /** Which lazy server a hidden node belongs to. */
    private readonly ownerOf = new Map<string, ServerTreeNode>();

    public readonly lazyServers: ServerTreeNode[];
    public readonly requestLog = { fetches: 0, searches: 0 };

    constructor(
        public readonly nodes: ServerTreeNode[],
        hidden: Map<string, ServerTreeNode[]>,
        lazyServers: ServerTreeNode[]
    ) {
        this.hidden = hidden;
        this.lazyServers = lazyServers;

        this.allNodes = [];
        const walk = (list: ServerTreeNode[] | null) => {
            for (const node of list ?? []) {
                this.allNodes.push(node);
                walk(node.children);
            }
        };
        walk(nodes);

        for (const server of lazyServers) {
            for (const child of hidden.get(server.id) ?? []) {
                this.allNodes.push(child);
                this.ownerOf.set(child.id, server);
            }
        }
    }

    public get totalNodes() {
        return this.allNodes.length;
    }

    public get hiddenNodes() {
        let count = 0;
        for (const children of this.hidden.values()) {
            count += children.length;
        }
        return count;
    }

    /** Fetches a lazy server's cameras. */
    public fetchChildren(server: ServerTreeNode): Promise<ServerTreeNode[]> {
        this.requestLog.fetches++;
        const children = this.hidden.get(server.id) ?? [];
        return new Promise(resolve => setTimeout(() => resolve(children), FETCH_LATENCY_MS));
    }

    /**
     * Searches the whole data set, including nodes the client has never loaded, and reports
     * which lazy servers the client needs in order to display the results.
     */
    public search(term: string): Promise<ServerSearchResult> {
        this.requestLog.searches++;
        const needle = term.trim().toLowerCase();

        return new Promise(resolve =>
            setTimeout(() => {
                const matchIds = new Set<string>();
                const serversToLoad = new Set<ServerTreeNode>();
                let hiddenMatches = 0;

                for (const node of this.allNodes) {
                    if (!matches(node, needle)) {
                        continue;
                    }
                    matchIds.add(node.id);

                    const owner = this.ownerOf.get(node.id);
                    if (owner) {
                        hiddenMatches++;
                        serversToLoad.add(owner);
                    }
                }

                resolve({ matchIds, serversToLoad: [...serversToLoad], total: matchIds.size, hiddenMatches });
            }, SEARCH_LATENCY_MS)
        );
    }
}

/** The predicate both search modes use, so the two paths are genuinely comparable. */
export function matches(node: ServerTreeNode, needle: string) {
    return (
        node.name.toLowerCase().includes(needle) ||
        node.data.ip.includes(needle) ||
        node.data.typeOfNode.toLowerCase().includes(needle)
    );
}
