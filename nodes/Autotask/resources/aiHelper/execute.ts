import type { IExecuteFunctions, INodeExecutionData, IDataObject } from 'n8n-workflow';
import { describeResource, listPicklistValues, validateParameters } from '../../helpers/aiHelper';
import { validateJsonParameter } from '../../helpers/json-validation';

const ENTITY_TYPE = 'aiHelper';

export async function executeAiHelperOperation(
    this: IExecuteFunctions,
): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    const operation = this.getNodeParameter('operation', 0) as string;

    for (let i = 0; i < items.length; i++) {
        try {
            switch (operation) {
                case 'describeResource': {
                    const targetResource = this.getNodeParameter('targetResource', i) as string;
                    const mode = this.getNodeParameter('mode', i) as 'read' | 'write';

                    const response = await describeResource(this, targetResource, mode);
                    returnData.push({ json: response as unknown as IDataObject });
                    break;
                }

                case 'listPicklistValues': {
                    const targetResource = this.getNodeParameter('targetResource', i) as string;
                    const fieldId = this.getNodeParameter('fieldId', i) as string;
                    const query = this.getNodeParameter('query', i, '') as string;
                    const limit = this.getNodeParameter('limit', i, 50) as number;
                    const page = this.getNodeParameter('page', i, 1) as number;

                    const response = await listPicklistValues(
                        this,
                        targetResource,
                        fieldId,
                        query || undefined,
                        limit,
                        page
                    );
                    returnData.push({ json: response as unknown as IDataObject });
                    break;
                }

                case 'validateParameters': {
                    const targetResource = this.getNodeParameter('targetResource', i) as string;
                    const mode = this.getNodeParameter('mode', i) as 'create' | 'update';
                    const rawFieldValues = this.getNodeParameter('fieldValues', i) as unknown;

                    // Validate JSON format first
                    const validation = validateJsonParameter(rawFieldValues, 'bodyJson', targetResource);
                    if (!validation.isValid) {
                        throw validation.error!;
                    }

                    const fieldValues = validation.parsedValue as Record<string, unknown>;

                    const response = await validateParameters(
                        this,
                        targetResource,
                        mode,
                        fieldValues
                    );
                    returnData.push({ json: response as unknown as IDataObject });
                    break;
                }

                default:
                    throw new Error(`The operation "${operation}" is not supported for ${ENTITY_TYPE}`);
            }
        } catch (error) {
            if (this.continueOnFail()) {
                returnData.push({
                    json: {
                        error: error.message,
                        operation,
                        resource: ENTITY_TYPE,
                    },
                });
                continue;
            }
            throw error;
        }
    }

    return [returnData];
}
