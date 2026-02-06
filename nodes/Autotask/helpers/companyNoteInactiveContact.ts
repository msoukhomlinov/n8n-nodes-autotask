import type { IExecuteFunctions } from 'n8n-workflow';
import type { IAutotaskEntity } from '../types';
import { CreateOperation, UpdateOperation, getOperationFieldValues } from '../operations/base';
import { autotaskApiRequest, buildChildEntityUrl } from './http';

const ENTITY_TYPE = 'companyNote';

const CONTACTID_ERROR_PATTERN = /contactID.*does not exist or is invalid/i;

export function isInactiveContactError(error: unknown): boolean {
	const message = error && typeof (error as Error).message === 'string' ? (error as Error).message : '';
	return CONTACTID_ERROR_PATTERN.test(message);
}

async function getContactIdsAndEnsureInactive(
	context: IExecuteFunctions,
	itemIndex: number,
	operation: 'create' | 'update',
	originalError: Error,
): Promise<{ contactIdNum: number; companyIdNum: number }> {
	const fieldValues = await getOperationFieldValues(context, ENTITY_TYPE, itemIndex, operation);
	const contactID = fieldValues.contactID;
	const companyID = fieldValues.companyID;

	if (contactID === undefined || contactID === null || companyID === undefined || companyID === null) {
		throw originalError;
	}

	const contactIdNum = typeof contactID === 'number' ? contactID : parseInt(String(contactID), 10);
	const companyIdNum = typeof companyID === 'number' ? companyID : parseInt(String(companyID), 10);
	if (Number.isNaN(contactIdNum) || Number.isNaN(companyIdNum)) {
		throw originalError;
	}

	const contactEndpoint = buildChildEntityUrl('Company', 'Contact', companyIdNum, { entityId: contactIdNum });
	const contactResponse = await autotaskApiRequest.call(context, 'GET', contactEndpoint) as { item: { isActive?: boolean | number } };
	const isActive = contactResponse?.item?.isActive === true || contactResponse?.item?.isActive === 1;

	if (isActive) {
		throw originalError;
	}

	return { contactIdNum, companyIdNum };
}

async function withTemporaryContactActivation<T>(
	context: IExecuteFunctions,
	itemIndex: number,
	originalError: Error,
	operation: 'create' | 'update',
	runOperation: () => Promise<T>,
	operationLabel: string,
): Promise<T> {
	const { contactIdNum, companyIdNum } = await getContactIdsAndEnsureInactive(
		context,
		itemIndex,
		operation,
		originalError,
	);

	const patchEndpoint = buildChildEntityUrl('Company', 'Contact', companyIdNum, { entityId: contactIdNum });

	console.warn(
		'[CompanyNote] contactID references an inactive contact; temporarily activating contact',
		contactIdNum,
		'to',
		operationLabel,
		', then deactivating again.',
	);

	await autotaskApiRequest.call(context, 'PATCH', patchEndpoint, { id: contactIdNum, isActive: true });

	try {
		return await runOperation();
	} finally {
		try {
			await autotaskApiRequest.call(context, 'PATCH', patchEndpoint, { id: contactIdNum, isActive: false });
			console.warn('[CompanyNote] Contact', contactIdNum, 'deactivated again after', operationLabel, '.');
		} catch (deactivateError) {
			console.warn(
				'[CompanyNote] Failed to deactivate contact',
				contactIdNum,
				'after',
				operationLabel,
				'. The operation completed successfully; please deactivate the contact manually if required.',
				deactivateError,
			);
		}
	}
}

export async function createWithTemporaryContactActivation(
	context: IExecuteFunctions,
	itemIndex: number,
	originalError: Error,
): Promise<IAutotaskEntity> {
	return withTemporaryContactActivation(
		context,
		itemIndex,
		originalError,
		'create',
		async () => {
			const createOp = new CreateOperation<IAutotaskEntity>(ENTITY_TYPE, context);
			return await createOp.execute(itemIndex) as IAutotaskEntity;
		},
		'create the note',
	);
}

export async function updateWithTemporaryContactActivation(
	context: IExecuteFunctions,
	itemIndex: number,
	entityId: string,
	originalError: Error,
): Promise<IAutotaskEntity> {
	return withTemporaryContactActivation(
		context,
		itemIndex,
		originalError,
		'update',
		async () => {
			const updateOp = new UpdateOperation<IAutotaskEntity>(ENTITY_TYPE, context);
			return await updateOp.execute(itemIndex, entityId) as IAutotaskEntity;
		},
		'update the note',
	);
}
