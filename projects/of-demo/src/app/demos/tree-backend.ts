import { TreeDataModel } from './tree-data';

/** Simulated network latency for the stub API. */
const FETCH_LATENCY_MS = 250;
const SEARCH_LATENCY_MS = 300;

export interface TreeSearchResult {
    /** Ids of every node that matched, including nodes the client has not loaded. */
    matchIds: Set<string>;
    /** Lazy servers the client must load before it can show all of those matches. */
    serversToLoad: TreeDataModel[];
    /** How many matches the server found in total. */
    total: number;
    /** How many of those are behind nodes the client had not loaded. */
    hiddenMatches: number;
}

/**
 * Stands in for the API. It owns the authoritative data set - including the children of lazy
 * servers, which the client has not fetched - so it can answer questions the client cannot.
 */
export class TreeBackend {
    /** Children of lazy servers, keyed by server id. The client does not have these yet. */
    private readonly hidden: Map<string, TreeDataModel[]>;
    /** Flat view of every node in existence, loaded or not. */
    private readonly allNodes: TreeDataModel[];
    /** Which lazy server a hidden node belongs to. */
    private readonly ownerOf = new Map<string, TreeDataModel>();

    public readonly lazyServers: TreeDataModel[];
    public readonly requestLog = { fetches: 0, searches: 0 };

    constructor(
        public readonly nodes: TreeDataModel[],
        hidden: Map<string, TreeDataModel[]>,
        lazyServers: TreeDataModel[]
    ) {
        this.hidden = hidden;
        this.lazyServers = lazyServers;

        this.allNodes = [];
        const walk = (list: TreeDataModel[] | null) => {
            for (const node of list ?? []) {
                this.allNodes.push(node);
                walk(node.children);
            }
        };
        walk(nodes);

        // Recurse: a lazy server's subtree can be more than one level deep (GPU servers hold
        // pipelines, which hold cameras). Indexing only direct children would make those
        // cameras invisible to server-side search.
        const indexHidden = (list: TreeDataModel[] | null, owner: TreeDataModel) => {
            for (const node of list ?? []) {
                this.allNodes.push(node);
                this.ownerOf.set(node.id, owner);
                indexHidden(node.children, owner);
            }
        };
        for (const server of lazyServers) {
            indexHidden(hidden.get(server.id) ?? null, server);
        }
    }

    public get totalNodes() {
        return this.allNodes.length;
    }

    /** Counts whole hidden subtrees, not just the direct children of each lazy server. */
    public get hiddenNodes() {
        const count = (list: TreeDataModel[] | null): number =>
            (list ?? []).reduce((total, node) => total + 1 + count(node.children), 0);

        let total = 0;
        for (const children of this.hidden.values()) {
            total += count(children);
        }
        return total;
    }

    /** Fetches a lazy server's cameras. */
    public fetchChildren(server: TreeDataModel): Promise<TreeDataModel[]> {
        this.requestLog.fetches++;
        const children = this.hidden.get(server.id) ?? [];
        return new Promise(resolve => setTimeout(() => resolve(children), FETCH_LATENCY_MS));
    }

    /**
     * Searches the whole data set, including nodes the client has never loaded, and reports
     * which lazy servers the client needs in order to display the results.
     */
    public search(term: string): Promise<TreeSearchResult> {
        this.requestLog.searches++;
        const needle = term.trim().toLowerCase();

        return new Promise(resolve =>
            setTimeout(() => {
                const matchIds = new Set<string>();
                const serversToLoad = new Set<TreeDataModel>();
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
export function matches(node: TreeDataModel, needle: string) {
    return (
        node.name.toLowerCase().includes(needle) ||
        node.data.ip.includes(needle) ||
        node.data.typeOfNode.toLowerCase().includes(needle)
    );
}
