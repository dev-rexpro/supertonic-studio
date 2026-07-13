import type { GoogleGenAI } from '@google/genai';
import { MASBRO_PERSONAS } from '$lib/types/persona';

export const CASCADE_TIERS: Record<string, string[]> = {
	'masbro-3-thinker': ['gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'],
	'masbro-3': ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'],
	'masbro-3-fast': ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite']
};

function is429Error(err: any): boolean {
	if (!err) return false;
	const status = err.status || err.statusCode || err.response?.status;
	if (status === 429) return true;
	const msg = String(err.message || '').toLowerCase();
	if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota exceeded')) {
		return true;
	}
	return false;
}

async function* handleSmartMasbroChatStream(
	ai: GoogleGenAI,
	sdkInput: any,
	selectedPersonaInstruction: string,
	selectedTemperature: number,
	fallbackModels: string[],
	selectedTools: any[]
) {
	let lastError: any = null;

	for (const currentModelInCascade of fallbackModels) {
		try {
			console.log(`[masbroService] Attempting interactions.create stream with model: ${currentModelInCascade}`);
			const geminiStream = await ai.interactions.create({
				model: currentModelInCascade,
				input: sdkInput,
				system_instruction: selectedPersonaInstruction,
				generation_config: {
					temperature: selectedTemperature
				},
				tools: selectedTools.length > 0 ? selectedTools : undefined,
				stream: true
			});

			const buffer: any[] = [];
			let gotRateLimitError = false;

			const iterator = geminiStream[Symbol.asyncIterator]();

			while (true) {
				const { value: event, done } = await iterator.next();
				if (done) break;

				buffer.push(event);

				if (event.event_type === 'error') {
					const msg = String(event.error?.message || '').toLowerCase();
					const code = String(event.error?.code || '').toLowerCase();
					if (code === 'too_many_requests' || msg.includes('429') || msg.includes('rate limit') || msg.includes('quota exceeded')) {
						gotRateLimitError = true;
						break;
					}
				}

				if (event.event_type === 'step.start' || event.event_type === 'step.delta') {
					break;
				}
			}

			if (gotRateLimitError) {
				console.warn(`[masbroService] Stream for model ${currentModelInCascade} failed with rate limit in stream events. Cascading...`);
				continue;
			}

			for (const event of buffer) {
				yield event;
			}

			while (true) {
				const { value: event, done } = await iterator.next();
				if (done) break;
				yield event;
			}

			return;
		} catch (err: any) {
			lastError = err;
			if (is429Error(err) && currentModelInCascade !== fallbackModels[fallbackModels.length - 1]) {
				console.warn(`[masbroService] Model ${currentModelInCascade} failed to initiate stream. Cascading...`);
				continue;
			}
			throw err;
		}
	}

	throw lastError || new Error('All cascade models failed in stream.');
}

export async function handleSmartMasbroChat(
	ai: GoogleGenAI,
	prompt: any, // Can be string or Array<Content> for history
	personaKey: 'friendly' | 'standar' | 'formal',
	options: {
		stream?: boolean;
		tier?: string; // e.g., 'masbro-3-thinker', 'masbro-3', 'masbro-3-fast'
		systemInstructionOverride?: string;
		toolsConfig?: any;
	} = {}
) {
	const persona = MASBRO_PERSONAS[personaKey] || MASBRO_PERSONAS.standar;
	const selectedPersonaInstruction = options.systemInstructionOverride || persona.systemInstruction;
	
	// Temperature mapping: 0.75 for friendly, 0.5 for standar, 0.3 for formal
	const tempMap = {
		friendly: 0.75,
		standar: 0.5,
		formal: 0.3
	};
	const selectedTemperature = tempMap[personaKey] ?? 0.5;

	// Construct input for Interactions API (avoiding turn_list/step_list mismatch error)
	let sdkInput: any;
	if (Array.isArray(prompt)) {
		let finalPrompt = '';
		if (prompt.length > 1) {
			const history = prompt
				.slice(0, -1)
				.map((c) => {
					const text = c.parts
						.filter((p: any) => p.text)
						.map((p: any) => p.text)
						.join('\n');
					return `[${c.role}]: ${text}`;
				})
				.join('\n\n');
			finalPrompt += `Here is the conversation history so far for context:\n\n${history}\n\n`;
		}
		const latest = prompt[prompt.length - 1];
		const latestText = latest
			? latest.parts
					.filter((p: any) => p.text)
					.map((p: any) => p.text)
					.join('\n')
			: '';
		finalPrompt += latestText;

		const multimodalParts = latest
			? latest.parts.filter((p: any) => p.inlineData)
			: [];

		if (multimodalParts.length > 0) {
			sdkInput = [{ type: 'text', text: finalPrompt }];
			for (const p of multimodalParts) {
				const mime = p.inlineData.mimeType || 'image/jpeg';
				let type: 'image' | 'audio' | 'video' | 'document' = 'image';
				if (mime.startsWith('audio/')) {
					type = 'audio';
				} else if (mime.startsWith('video/')) {
					type = 'video';
				} else if (mime.startsWith('application/pdf') || mime.startsWith('text/')) {
					type = 'document';
				}
				sdkInput.push({
					type,
					data: p.inlineData.data,
					mime_type: mime
				});
			}
		} else {
			sdkInput = finalPrompt;
		}
	} else {
		sdkInput = prompt;
	}

	const tier = options.tier || 'masbro-3';
	const fallbackModels = CASCADE_TIERS[tier] || [tier];

	// Build tools list based on toolsMode config
	const toolsConfig = options.toolsConfig || { toolsMode: 'auto' };
	const selectedTools: any[] = [];
	if (toolsConfig.toolsMode === 'manual') {
		if (toolsConfig.googleSearchGroundingEnabled) {
			selectedTools.push({ type: 'google_search' });
		}
		if (toolsConfig.codeExecutionEnabled) {
			selectedTools.push({ type: 'code_execution' });
		}
	} else {
		// Auto mode: enable both search and sandbox execution
		selectedTools.push({ type: 'google_search' });
		selectedTools.push({ type: 'code_execution' });
	}

	if (options.stream) {
		const response = handleSmartMasbroChatStream(
			ai,
			sdkInput,
			selectedPersonaInstruction,
			selectedTemperature,
			fallbackModels,
			selectedTools
		);
		return { response, modelUsed: fallbackModels[0] };
	}

	let lastError: any = null;

	for (const currentModelInCascade of fallbackModels) {
		try {
			console.log(`[masbroService] Attempting interactions.create with model: ${currentModelInCascade}`);
			const response = await ai.interactions.create({
				model: currentModelInCascade,
				input: sdkInput,
				system_instruction: selectedPersonaInstruction,
				generation_config: {
					temperature: selectedTemperature
				},
				tools: selectedTools.length > 0 ? selectedTools : undefined,
				stream: false
			});
			return { response, modelUsed: currentModelInCascade };
		} catch (err: any) {
			lastError = err;
			if (is429Error(err) && currentModelInCascade !== fallbackModels[fallbackModels.length - 1]) {
				console.warn(`[masbroService] Model ${currentModelInCascade} failed with 429. Cascading...`);
				continue;
			}
			throw err;
		}
	}

	throw lastError || new Error('All cascade models failed.');
}
