import React, { useState } from 'react';
import { ResearchData, Lead } from '../types';
import { X, ExternalLink, Globe, TrendingUp, Loader } from 'lucide-react';

interface Props {
  research: ResearchData | null;
  companyName: string;
  website?: string;
  lead?: Lead;
  onClose: () => void;
  onLeadUpdate?: (lead: Lead) => void;
}

export const ResearchDetailView: React.FC<Props> = ({ research, companyName, website, lead, onClose, onLeadUpdate }) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentResearch, setCurrentResearch] = useState(research);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateResearch = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const response = await fetch('/api/research/conduct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName,
          websiteUrl: website || '',
          targetQuality: 8,
          maxAttempts: 3
        })
      });
      const result = await response.json();
      if (result.success && result.research) {
        setCurrentResearch(result.research);
        // Update lead if provided
        if (lead && onLeadUpdate) {
          const updatedLead = { ...lead, research: result.research, researchQuality: result.research.researchQuality };
          onLeadUpdate(updatedLead);
        }
      } else {
        setError(result.message || 'Research generation failed');
      }
    } catch (err) {
      setError('Error generating research: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsGenerating(false);
    }
  };

  const researchData = currentResearch || research;
  const qualityColor = (researchData?.researchQuality || 0) >= 8 
    ? 'text-green-700 bg-green-50 border-green-200' 
    : (researchData?.researchQuality || 0) >= 5
    ? 'text-orange-700 bg-orange-50 border-orange-200'
    : 'text-red-700 bg-red-50 border-red-200';

  const qualityBadge = (researchData?.researchQuality || 0) >= 8 
    ? '✓ Ready' 
    : (researchData?.researchQuality || 0) >= 5
    ? '⚠️ Needs Work'
    : '✗ Low Quality';

  return (
    <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-slate-900 to-slate-800 text-white p-6 border-b border-slate-700 flex justify-between items-start rounded-t-2xl flex-shrink-0">
          <div className="flex-1">
            <h2 className="text-2xl font-bold mb-2">{companyName} - Research Data</h2>
            <div className={`inline-block px-3 py-1 rounded-lg border ${qualityColor} font-bold text-sm`}>
              Quality: {researchData?.researchQuality || 0}/10 {qualityBadge}
            </div>
          </div>
          <button onClick={onClose} className="text-white hover:bg-slate-700 p-2 rounded-lg transition-colors flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
          {/* Error Message */}
          {error && (
            <div className="bg-red-50 p-4 rounded-lg border border-red-200">
              <p className="text-sm text-red-700 font-semibold">{error}</p>
            </div>
          )}

          {/* Generate Research Button */}
          {(!researchData || Object.keys(researchData).length === 1) && (
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <p className="text-sm text-blue-700 mb-3">No research data yet. Generate research to discover company insights.</p>
              <button
                onClick={handleGenerateResearch}
                disabled={isGenerating}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 font-bold rounded-lg transition-colors ${
                  isGenerating
                    ? 'bg-blue-400 text-white cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {isGenerating ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    Generating Research...
                  </>
                ) : (
                  <>
                    <TrendingUp className="w-4 h-4" />
                    Generate Research
                  </>
                )}
              </button>
            </div>
          )}

          {/* Company Overview */}
          {researchData?.companyOverview && (
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-2">Company Overview</h3>
              <p className="text-sm text-slate-700 leading-relaxed">{researchData.companyOverview}</p>
            </div>
          )}

          {/* Industry & Competitive */}
          <div className="grid grid-cols-2 gap-4">
            {researchData?.industryVertical && (
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="text-xs font-bold text-blue-700 uppercase tracking-wider mb-2">Industry Vertical</h3>
                <p className="text-sm text-blue-900">{researchData.industryVertical}</p>
              </div>
            )}
            {researchData?.competitiveAdvantage && (
              <div className="bg-emerald-50 p-4 rounded-lg border border-emerald-200">
                <h3 className="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-2">Competitive Advantage</h3>
                <p className="text-sm text-emerald-900">{researchData.competitiveAdvantage}</p>
              </div>
            )}
          </div>

          {/* Key Services */}
          {researchData?.keyServices && researchData.keyServices.length > 0 && (
            <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
              <h3 className="text-xs font-bold text-purple-700 uppercase tracking-wider mb-3">Key Services</h3>
              <div className="flex flex-wrap gap-2">
                {researchData.keyServices.map((service, i) => (
                  <span key={i} className="px-3 py-1 bg-white text-purple-700 border border-purple-200 rounded-full text-xs font-semibold">
                    {service}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Pain Points */}
          {researchData?.potentialPainPoints && researchData.potentialPainPoints.length > 0 && (
            <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
              <h3 className="text-xs font-bold text-orange-700 uppercase tracking-wider mb-3">Potential Pain Points</h3>
              <ul className="space-y-2">
                {researchData.potentialPainPoints.map((pain, i) => (
                  <li key={i} className="text-sm text-orange-900 flex items-start gap-2">
                    <span className="text-orange-500 font-bold mt-0.5">•</span>
                    <span>{pain}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Outreach Angle */}
          {researchData?.outreachAngle && (
            <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
              <h3 className="text-xs font-bold text-indigo-700 uppercase tracking-wider mb-2">Outreach Angle</h3>
              <p className="text-sm text-indigo-900 italic">{researchData.outreachAngle}</p>
            </div>
          )}

          {/* Personalized Hooks */}
          {researchData?.personalizedHooks && researchData.personalizedHooks.length > 0 && (
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <h3 className="text-xs font-bold text-green-700 uppercase tracking-wider mb-3">Personalized Hooks</h3>
              <ul className="space-y-2">
                {researchData.personalizedHooks.map((hook, i) => (
                  <li key={i} className="text-sm text-green-900 flex items-start gap-2">
                    <span className="text-green-600 font-bold mt-0.5">→</span>
                    <span>{hook}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Key People */}
          {researchData?.keyPeople && researchData.keyPeople.length > 0 && (
            <div className="bg-cyan-50 p-4 rounded-lg border border-cyan-200">
              <h3 className="text-xs font-bold text-cyan-700 uppercase tracking-wider mb-3">Key People</h3>
              <div className="flex flex-wrap gap-2">
                {researchData.keyPeople.map((person, i) => (
                  <span key={i} className="px-3 py-1 bg-white text-cyan-700 border border-cyan-300 rounded-full text-xs font-semibold">
                    {person}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recent Triggers */}
          {researchData?.recentTriggers && researchData.recentTriggers.length > 0 && (
            <div className="bg-red-50 p-4 rounded-lg border border-red-200">
              <h3 className="text-xs font-bold text-red-700 uppercase tracking-wider mb-3">Recent Triggers 🔥</h3>
              <ul className="space-y-2">
                {researchData.recentTriggers.map((trigger, i) => (
                  <li key={i} className="text-sm text-red-900 flex items-start gap-2">
                    <span className="text-red-600 font-bold mt-0.5">!</span>
                    <span>{trigger}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* News Articles */}
          {researchData?.newsArticles && researchData.newsArticles.length > 0 && (
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Globe className="w-4 h-4" /> News Articles
              </h3>
              <div className="space-y-2">
                {researchData.newsArticles.map((article, i) => (
                  <a 
                    key={i}
                    href={article.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-2 bg-white rounded border border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-colors group"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-800 group-hover:text-blue-700">{article.title}</p>
                        <p className="text-xs text-slate-500 mt-1">{new Date(article.pubDate).toLocaleDateString()}</p>
                      </div>
                      <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-blue-600 flex-shrink-0 mt-0.5" />
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Retry Button for Low Quality */}
          {researchData && (researchData.researchQuality || 0) < 8 && (researchData.researchQuality || 0) > 0 && (
            <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
              <p className="text-sm text-amber-700 mb-3">Research quality is below target. Try generating again to find better data.</p>
              <button
                onClick={handleGenerateResearch}
                disabled={isGenerating}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 font-bold rounded-lg transition-colors ${
                  isGenerating
                    ? 'bg-amber-400 text-white cursor-not-allowed'
                    : 'bg-amber-600 text-white hover:bg-amber-700'
                }`}
              >
                {isGenerating ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    Retrying...
                  </>
                ) : (
                  <>
                    <TrendingUp className="w-4 h-4" />
                    Try Again
                  </>
                )}
              </button>
            </div>
          )}

          {/* Metadata */}
          {researchData && (
            <div className="grid grid-cols-2 gap-4 text-xs text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200">
              {researchData.websiteScrapedAt && (
                <div>
                  <span className="font-semibold">Website Scraped:</span> {new Date(researchData.websiteScrapedAt).toLocaleDateString()}
                </div>
              )}
              {researchData.newsFoundAt && (
                <div>
                  <span className="font-semibold">News Found:</span> {new Date(researchData.newsFoundAt).toLocaleDateString()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Close Button */}
        <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 p-4 rounded-b-2xl flex justify-end flex-shrink-0">
          <button 
            onClick={onClose}
            className="px-6 py-2 bg-slate-900 text-white font-bold rounded-lg hover:bg-slate-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
