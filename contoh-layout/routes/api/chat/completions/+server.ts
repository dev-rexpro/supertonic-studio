/* eslint-disable @typescript-eslint/no-explicit-any */
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GoogleGenAI } from '@google/genai';
import { env } from '$env/dynamic/private';
import { MASBRO_PERSONAS } from '$lib/types/persona';
import { handleSmartMasbroChat } from '$lib/services/masbroService';

export const POST: RequestHandler = async ({ request }) => {
	const apiKey = env.GEMINI_API_KEY || '';

	if (!apiKey) {
		return new Response(
			JSON.stringify({
				error: {
					message: 'GEMINI_API_KEY environment variable is not configured.'
				}
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}

	const ai = new GoogleGenAI({ apiKey });

	let requestBody;
	try {
		requestBody = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const { messages, model, temperature, max_tokens, stream, tools_config, enableThinking, reasoningEffort, selectedPersona } = requestBody;
	if (!messages || !Array.isArray(messages)) {
		throw error(400, 'Missing or invalid messages array');
	}

	const modelName = model || 'gemini-3.5-flash';

	// Map OpenAI-like roles/messages to Gemini contents
	const contents = messages.map((msg) => {
		let role = msg.role;
		if (role === 'assistant') {
			role = 'model';
		}

		const parts: any[] = [];
		if (typeof msg.content === 'string') {
			parts.push({ text: msg.content });
		} else if (Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (part.type === 'text') {
					parts.push({ text: part.text });
				} else if (part.type === 'image_url') {
					const base64Parts = part.image_url.url.split(',');
					const base64Data = base64Parts[1] || base64Parts[0];
					let mimeType = 'image/jpeg';
					const mimeMatch = part.image_url.url.match(/data:(.*?);/);
					if (mimeMatch) {
						mimeType = mimeMatch[1];
					}
					parts.push({
						inlineData: {
							data: base64Data,
							mimeType: mimeType
						}
					});
				} else if (part.type === 'input_audio') {
					const mimeType = part.input_audio.format === 'wav' ? 'audio/wav' : 'audio/mp3';
					parts.push({
						inlineData: {
							data: part.input_audio.data,
							mimeType: mimeType
						}
					});
				} else if (part.type === 'input_video') {
					const mimeType = part.input_video.format === 'mp4' ? 'video/mp4' : 'video/ogg';
					parts.push({
						inlineData: {
							data: part.input_video.data,
							mimeType: mimeType
						}
					});
				}
			}
		}
		return { role, parts };
	});

	// Extract system instruction if present
	const systemMessage = messages.find((m) => m.role === 'system');
	const systemInstruction = systemMessage
		? typeof systemMessage.content === 'string'
			? systemMessage.content
			: systemMessage.content.map((p: any) => p.text).join('\n')
		: undefined;

	let finalSystemInstruction = systemInstruction;

	if (tools_config?.urlContextEnabled) {
		const urlRegex = /(https?:\/\/[^\s]+)/g;
		const foundUrls: string[] = [];
		for (const msg of messages) {
			if (typeof msg.content === 'string') {
				const matches = msg.content.match(urlRegex);
				if (matches) {
					for (const m of matches) {
						const cleanUrl = m.replace(/[.,;:!?)]+$/, '');
						if (!foundUrls.includes(cleanUrl)) foundUrls.push(cleanUrl);
					}
				}
			}
		}

		if (foundUrls.length > 0) {
			let scrapedBlocks = '\n\n=== URL CONTEXT REFERENCES ===';
			for (const url of foundUrls) {
				try {
					const response = await fetch(url, {
						headers: {
							'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
						}
					});
					if (response.ok) {
						const rawText = await response.text();
						const cleanText = rawText
							.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
							.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
							.replace(/<[^>]+>/g, ' ')
							.replace(/\s+/g, ' ')
							.trim()
							.slice(0, 5000);
						scrapedBlocks += `\nSource URL: ${url}\nContent Reference: ${cleanText}\n`;
					} else {
						scrapedBlocks += `\nSource URL: ${url}\n[Failed to fetch content]\n`;
					}
				} catch (err: any) {
					scrapedBlocks += `\nSource URL: ${url}\n[Error: ${err.message}]\n`;
				}
			}
			finalSystemInstruction = finalSystemInstruction 
				? `${finalSystemInstruction}\n${scrapedBlocks}`
				: scrapedBlocks;
		}
	}

	// Persona System lookup
	const persona = MASBRO_PERSONAS[selectedPersona as keyof typeof MASBRO_PERSONAS] || MASBRO_PERSONAS.standar;
	const baseInstruction = persona.systemInstruction;
	const retrySystemInstruction = finalSystemInstruction 
		? `${baseInstruction}\n\nAdditional instructions:\n${finalSystemInstruction}`
		: baseInstruction;

	// Filter system messages from conversation history
	const chatContents = contents.filter((c) => c.role !== 'system');

	if (!stream) {
		try {
			const { response, modelUsed } = await handleSmartMasbroChat(ai, chatContents, selectedPersona as any, {
				stream: false,
				tier: modelName,
				systemInstructionOverride: retrySystemInstruction,
				toolsConfig: tools_config
			});

			let content = '';
			let reasoning = '';
			for (const step of response.steps || []) {
				if (step.type === 'thought') {
					reasoning += step.summary || '';
				} else if (step.type === 'model_output') {
					const textContent = step.content?.find((c: any) => c.type === 'text');
					if (textContent?.text) {
						content += textContent.text;
					}
				}
			}

			if (!content && response.output_text) {
				content = response.output_text;
			}

			const timings = response.usage ? {
				prompt_n: response.usage.total_input_tokens,
				predicted_n: response.usage.total_output_tokens
			} : undefined;

			return new Response(
				JSON.stringify({
					id: response.id || `chatcmpl-${Date.now()}`,
					choices: [
						{
							message: {
								role: 'assistant',
								content,
								reasoning_content: reasoning || undefined
							}
						}
					],
					timings
				}),
				{ headers: { 'Content-Type': 'application/json' } }
			);
		} catch (err: any) {
			console.error('Error in handleSmartMasbroChat completions:', err);
			return new Response(
				JSON.stringify({
					error: {
						message: err.message || 'API request failed.'
					}
				}),
				{ status: 500, headers: { 'Content-Type': 'application/json' } }
			);
		}
	} else {
		// Streaming response
		const svelteStream = new ReadableStream({
			async start(controller) {
				const encoder = new TextEncoder();
				let isClosed = false;
				const sendChunk = (dataObj: any) => {
					if (isClosed) return;
					try {
						controller.enqueue(encoder.encode(`data: ${JSON.stringify(dataObj)}\n\n`));
					} catch (e) {
						isClosed = true;
					}
				};

				try {
					const { response: geminiStream, modelUsed } = await handleSmartMasbroChat(ai, chatContents, selectedPersona as any, {
						stream: true,
						tier: modelName,
						systemInstructionOverride: retrySystemInstruction,
						toolsConfig: tools_config
					});
					let currentStepType: string | null = null;

					for await (const event of geminiStream) {
						console.log(`[+server.ts] Received streaming event: ${event.event_type}`);
						if (event.event_type === 'error') {
							console.error('STREAM ERROR EVENT:', JSON.stringify(event, null, 2));
							throw new Error((event as any).error?.message || 'Gemini stream error');
						}
						if (event.event_type === 'step.start') {
							currentStepType = event.step?.type || null;
							if (currentStepType === 'google_search_call') {
								sendChunk({
									choices: [
										{
											delta: {
												reasoning_content: '\nSearching Google... \n'
											}
										}
									]
								});
							} else if (currentStepType === 'code_execution_call') {
								sendChunk({
									choices: [
										{
											delta: {
												reasoning_content: '\nRunning sandbox code... \n'
											}
										}
									]
								});
							}
						} else if (event.event_type === 'step.delta') {
							if (event.delta?.type === 'text') {
								const text = event.delta.text;
								if (currentStepType === 'thought') {
									sendChunk({
										choices: [
											{
												delta: {
													reasoning_content: text
												}
											}
										]
									});
								} else {
									sendChunk({
										choices: [
											{
												delta: {
													content: text
												}
											}
										]
									});
								}
							}
						}
					}
				} catch (err: any) {
					console.error('Error during handleSmartMasbroChat streaming:', err);
					sendChunk({
						error: {
							message: err.message || 'Streaming failed'
						}
					});
				} finally {
					if (!isClosed) {
						try {
							controller.enqueue(encoder.encode('data: [DONE]\n\n'));
						} catch (e) {}
						try {
							controller.close();
						} catch (e) {}
						isClosed = true;
					}
				}
			}
		});

		return new Response(svelteStream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive'
			}
		});
	}
};
