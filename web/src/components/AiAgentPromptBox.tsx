import React, { useState } from 'react';
import { PARLIAMENT_ADDRESS, BSC_CONFIG } from '../constants/contracts';
import llmsPromptRaw from '../../public/llms.txt?raw';

interface AiAgentPromptBoxProps {
  className?: string;
  customPrompt?: string;
}

export const generateDefaultAiPrompt = (
  chainId = BSC_CONFIG.chainId,
  parliamentContract = PARLIAMENT_ADDRESS
) => {
  const base = llmsPromptRaw.trim();
  if (chainId === BSC_CONFIG.chainId && parliamentContract === PARLIAMENT_ADDRESS) {
    return base;
  }
  return base
    .replace(/Chain 56/g, `Chain ${chainId}`)
    .replace(/"chainId":56/g, `"chainId":${chainId}`)
    .replace(new RegExp(PARLIAMENT_ADDRESS, 'gi'), parliamentContract);
};

export const DEFAULT_AI_PROMPT = generateDefaultAiPrompt();

export const AiAgentPromptBox: React.FC<AiAgentPromptBoxProps> = ({
  className = '',
  customPrompt,
}) => {
  const [copied, setCopied] = useState(false);
  const promptText = customPrompt || DEFAULT_AI_PROMPT;

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(promptText);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = promptText;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy prompt to clipboard:', err);
    }
  };

  return (
    <div
      className={`ai-agent-prompt-box w-[calc(100%-1.5rem)] md:w-[80%] max-w-[680px] mx-auto my-6 sm:my-9 min-w-0 box-border ${className}`}
      style={{
        border: '1px solid rgba(255, 255, 255, 0.06)',
        padding: '14px 16px',
        position: 'relative',
        backgroundColor: 'rgba(5, 5, 5, 0.7)',
        borderRadius: '6px',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Header with Caveat heading and simple copy button */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-white/5"
      >
        <p
          style={{
            fontFamily: "'Caveat', cursive",
            fontSize: '20px',
            color: 'var(--color-steel-blue, #8fa3b8)',
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          AI Agent Prompt
        </p>

        {/* Clean right-aligned llms.txt link & copy button */}
        <div className="inline-flex items-center gap-2 shrink-0">
          <a
            href="/llms.txt"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '11px',
              fontFamily: "'JetBrains Mono', monospace",
              color: 'var(--color-steel-blue, #8fa3b8)',
              textDecoration: 'none',
              borderRadius: '4px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
            className="inline-flex items-center min-h-[36px] md:min-h-0 px-2.5 py-1.5 md:px-2 md:py-1 hover:text-[#e5e4e2] hover:border-white/20"
            title="View plain-text prompt at /llms.txt"
          >
            llms.txt
          </a>

          <button
            onClick={handleCopy}
          aria-label={copied ? 'Copied prompt to clipboard' : 'Copy prompt'}
          title={copied ? 'Copied!' : 'Copy prompt'}
          style={{
            background: copied ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
            border: copied ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
            color: copied ? '#10b981' : 'var(--color-steel-blue, #8fa3b8)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '11px',
            fontFamily: "'Google Sans', sans-serif",
            transition: 'all 0.2s ease',
            borderRadius: '4px',
          }}
          className="inline-flex items-center min-h-[36px] md:min-h-0 px-2.5 py-1.5 md:px-2 md:py-1 hover:text-[#e5e4e2] hover:border-white/20 active:scale-95"
        >
          {copied ? (
            <>
              <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>Copied</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#10b981"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </>
          ) : (
            <>
              <span>Copy</span>
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </>
          )}
          </button>
        </div>
      </div>

      {/* Pure Prompt Body */}
      <pre
        className="min-w-0 max-w-full overflow-x-auto [overflow-wrap:anywhere]"
        style={{
          fontSize: '11.5px',
          color: 'var(--color-platinum, #e5e4e2)',
          lineHeight: '1.6',
          margin: 0,
          fontFamily: "'JetBrains Mono', monospace",
          whiteSpace: 'pre-wrap',
          background: 'transparent',
          border: 'none',
          padding: 0,
        }}
      >
        {promptText}
      </pre>
    </div>
  );
};

export default AiAgentPromptBox;
