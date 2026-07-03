import React from 'react';
import { DEMO_CONFIG } from '@/lib/mockData';

export function DemoCredit() {
  if (!DEMO_CONFIG.isDemo) {
    return null;
  }

  return (
    <footer className="demo-credit bg-gray-50 border-t border-gray-200 mt-12 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <h3 className="font-semibold text-sm mb-3">Data Source</h3>
            <p className="text-sm text-gray-600 mb-2">
              This demo uses data from the{' '}
              <a
                href={DEMO_CONFIG.credit.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                Discovery Benchmark
              </a>
              {' '}dataset.
            </p>
            <p className="text-xs text-gray-500">
              DOI:{' '}
              <a
                href={`https://doi.org/${DEMO_CONFIG.credit.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {DEMO_CONFIG.credit.doi}
              </a>
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-sm mb-3">License & Citation</h3>
            <p className="text-xs text-gray-600 mb-2">
              License:{' '}
              <a
                href="https://creativecommons.org/licenses/by/4.0/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                CC-BY-4.0
              </a>
            </p>
            <p className="text-xs text-gray-500 leading-relaxed">
              {DEMO_CONFIG.credit.citation}
            </p>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-gray-200 text-xs text-gray-500">
          <p>
            This is a static demo of CellSeer using the Discovery Benchmark dataset.
            For the full application with real-time data processing, visit{' '}
            <a href="https://cellseer.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              cellseer.com
            </a>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}
