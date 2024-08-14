import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeTypeDescription,
	IWebhookFunctions,
	NodeTypeAndVersion,
} from 'n8n-workflow';
import { WAIT_TIME_UNLIMITED, Node, updateDisplayOptions, NodeOperationError } from 'n8n-workflow';

import { formDescription, formFields, formTitle } from '../Form/common.descriptions';
import { prepareFormReturnItem, renderForm } from '../Form/utils';

import type { FormField } from './interfaces';

const pageProperties = updateDisplayOptions(
	{
		show: {
			operation: ['page'],
		},
	},
	[
		formFields,
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add option',
			default: {},
			options: [
				{ ...formTitle, required: false },
				formDescription,
				{
					displayName: 'Button Label',
					name: 'buttonLabel',
					type: 'string',
					default: 'Submit form',
				},
			],
		},
	],
);

const completionProperties = updateDisplayOptions(
	{
		show: {
			operation: ['completion'],
		},
	},
	[
		{
			displayName: 'Completion Title',
			name: 'completionTitle',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: 'Completion Message',
			name: 'completionMessage',
			type: 'string',
			default: '',
			typeOptions: {
				rows: 2,
			},
		},
		{
			displayName: 'Options',
			name: 'options',
			type: 'collection',
			placeholder: 'Add option',
			default: {},
			options: [{ ...formTitle, required: false }],
		},
	],
);

export class Form extends Node {
	nodeInputData: INodeExecutionData[] = [];

	description: INodeTypeDescription = {
		displayName: 'n8n Form Page',
		name: 'form',
		icon: 'file:form.svg',
		group: ['input'],
		version: 1,
		description: 'Create a multi-step webform by adding pages to a n8n form',
		defaults: {
			name: 'Form Page',
		},
		inputs: ['main'],
		outputs: ['main'],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'GET',
				responseMode: 'onReceived',
				path: '',
				restartWebhook: true,
				isFullPath: true,
				isForm: true,
			},
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: '',
				restartWebhook: true,
				isFullPath: true,
				isForm: true,
			},
		],
		properties: [
			{
				// eslint-disable-next-line n8n-nodes-base/node-param-display-name-miscased
				displayName: 'n8n Form Trigger node must be set before this node',
				name: 'triggerNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Page Type',
				name: 'operation',
				type: 'options',
				default: 'page',
				noDataExpression: true,
				options: [
					{
						name: 'Form Page',
						value: 'page',
					},
					{
						name: 'Form Completion Screen',
						value: 'completion',
					},
				],
			},
			...pageProperties,
			...completionProperties,
		],
	};

	async webhook(context: IWebhookFunctions) {
		const res = context.getResponseObject();

		const mode = context.getMode() === 'manual' ? 'test' : 'production';
		const fields = context.getNodeParameter('formFields.values', []) as FormField[];
		const operation = context.getNodeParameter('operation', '') as string;

		const parentNodes = context.getParentNodes(context.getNode().name);
		const trigger = parentNodes.find(
			(node) => node.type === 'n8n-nodes-base.formTrigger',
		) as NodeTypeAndVersion;

		const method = context.getRequestObject().method;

		if (operation === 'completion') {
			const completionTitle = context.getNodeParameter('completionTitle', '') as string;
			const completionMessage = context.getNodeParameter('completionMessage', '') as string;
			const options = context.getNodeParameter('options', {}) as {
				formTitle: string;
			};
			let title = options.formTitle;
			if (!title) {
				title = context.evaluateExpression(
					`{{ $('${trigger?.name}').params.formTitle }}`,
				) as string;
			}
			const appendAttribution = context.evaluateExpression(
				`{{ $('${trigger?.name}').params.options?.appendAttribution === false ? false : true }}`,
			) as boolean;

			res.render('form-trigger-completion', {
				title: completionTitle,
				message: completionMessage,
				formTitle: title,
				appendAttribution,
			});

			return {
				webhookResponse: { status: 200 },
				workflowData: [this.nodeInputData],
			};
		}

		if (method === 'GET') {
			const options = context.getNodeParameter('options', {}) as {
				formTitle: string;
				formDescription: string;
				buttonLabel: string;
			};

			let title = options.formTitle;
			if (!title) {
				title = context.evaluateExpression(
					`{{ $('${trigger?.name}').params.formTitle }}`,
				) as string;
			}

			let description = options.formDescription;
			if (!description) {
				description = context.evaluateExpression(
					`{{ $('${trigger?.name}').params.formDescription }}`,
				) as string;
			}

			let buttonLabel = options.buttonLabel;
			if (!buttonLabel) {
				buttonLabel =
					(context.evaluateExpression(
						`{{ $('${trigger?.name}').params.options?.buttonLabel }}`,
					) as string) || 'Submit form';
			}

			const responseMode = 'onReceived';

			let redirectUrl;

			const connectedNodes = context.getChildNodes(context.getNode().name);

			const hasNextPage = connectedNodes.some((node) => node.type === 'n8n-nodes-base.form');

			if (hasNextPage) {
				redirectUrl = context.evaluateExpression('{{ $execution.resumeFormUrl }}') as string;
			}

			const appendAttribution = context.evaluateExpression(
				`{{ $('${trigger?.name}').params.options?.appendAttribution === false ? false : true }}`,
			) as boolean;

			renderForm({
				context,
				res,
				formTitle: title,
				formDescription: description,
				formFields: fields,
				responseMode,
				mode,
				redirectUrl,
				appendAttribution,
				buttonLabel,
			});

			return {
				noWebhookResponse: true,
			};
		}

		let useWorkflowTimezone = context.evaluateExpression(
			`{{ $('${trigger?.name}').params.options?.useWorkflowTimezone }}`,
		) as boolean;

		if (useWorkflowTimezone === undefined && trigger?.typeVersion > 2) {
			useWorkflowTimezone = true;
		}

		const returnItem = await prepareFormReturnItem(context, fields, mode, useWorkflowTimezone);

		return {
			webhookResponse: { status: 200 },
			workflowData: [[returnItem]],
		};
	}

	async execute(context: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const operation = context.getNodeParameter('operation', 0);

		if (operation === 'completion') {
			this.nodeInputData = context.getInputData();
		}

		const parentNodes = context.getParentNodes(context.getNode().name);
		const hasFormTrigger = parentNodes.some((node) => node.type === 'n8n-nodes-base.formTrigger');

		if (!hasFormTrigger) {
			throw new NodeOperationError(
				context.getNode(),
				'Form Trigger node must be set before this node',
			);
		}

		const childNodes = context.getChildNodes(context.getNode().name);
		const hasNextPage = childNodes.some((node) => node.type === 'n8n-nodes-base.form');

		if (operation === 'completion' && hasNextPage) {
			throw new NodeOperationError(
				context.getNode(),
				'Completion has to be the last Form node in the workflow',
			);
		}

		const waitTill = new Date(WAIT_TIME_UNLIMITED);
		await context.putExecutionToWait(waitTill);
		return [context.getInputData()];
	}
}