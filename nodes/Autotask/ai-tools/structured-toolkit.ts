import { BaseToolkit } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';

/**
 * Trivial BaseToolkit subclass that wraps an array of tools.
 * Used to supply multiple DynamicStructuredTools to the AI Agent.
 */
export class AutotaskStructuredToolkit extends BaseToolkit {
    tools: StructuredToolInterface[];

    constructor(tools: StructuredToolInterface[]) {
        super();
        this.tools = tools as StructuredToolInterface[];
    }

    getTools(): StructuredToolInterface[] {
        return this.tools;
    }
}
