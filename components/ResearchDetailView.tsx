import React from 'react';
import { ResearchData } from '../types';
import { X, ExternalLink, Globe, TrendingUp } from 'lucide-react';

interface Props {
  research: ResearchData;
  companyName: string;
  onClose: () => void;
}

export const ResearchDetailView: React.FC<Props> = ({ research, companyName, onClose }) => {
  const qualityColor = (research.researchQuality || 0) >= 8 
    ? 'text-green-700 bg-green-50 border-green-200' 
    : (research.researchQuality || 0) >= 5
    ? 'text-orange-700 bg-orange-50 border-orange-200'
    : 'text-red-700 bg-red-50 border-red-200';

  const qualityBadge = (research.researchQuality || 0) >= 8 
    ? '✓ Ready' 
    : (research.researchQuality || 0) >= 5
    ? '⚠️ Needs Work'
    : '✗ Low Quality';

  return (
    <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-slate-900 to-slate-800 text-white p-6 border-b border-slate-700 flex justify-between items-start rounded-t-2xl">
          <div className="flex-1">
            <h2 className="text-2xl font-bold mb-2">{companyName} - Research Data</h2>
            <div className={`inline-block px-3 py-1 rounded-lg border ${qualityColor} font-bold text-sm`}>
              Quality: {research.researchQuality || 0}/10 {qualityBadge}
            </div>
          </div>
          <button onClick={onClose} className="text-white hover:bg-slate-700 p-2 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Company Overview */}
          {research.companyOverview && (
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-2">Company Overview</h3>
              <p className="text-sm text-slate-700 leading-relaxed">{research.companyOverview}</p>
            </div>
          )}

          {/* Industry & Competitive */}
          <div className="grid grid-cols-2 gap-4">
            {research.industryVertical && (
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="text-xs font-bold text-blue-700 uppercase tracking-wider mb-2">Industry Vertical</h3>
                <p className="text-sm text-blue-900">{research.industryVertical}</p>
              </div>
            )}
            {research.competitiveAdvantage && (
              <div className="bg-emerald-50 p-4 rounded-lg border border-emerald-200">
                <h3 className="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-2">Competitive Advantage</h3>
                <p className="text-sm text-emerald-900">{research.competitiveAdvantage}</p>
              </div>
            )}
          </div>

          {/* Key Services */}
          {research.keyServices && research.keyServices.length > 0 && (
            <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
              <h3 className="text-xs font-bold text-purple-700 uppercase tracking-wider mb-3">Key Services</h3>
              <div className="flex flex-wrap gap-2">
                {research.keyServices.map((service, i) => (
                  <span key={i} className="px-3 py-1 bg-white text-purple-700 border border-purple-200 rounded-full text-xs font-semibold">
                    {service}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Pain Points */}
          {research.potentialPainPoints && research.potentialPainPoints.length > 0 && (
            <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
              <h3 className="text-xs font-bold text-orange-700 uppercase tracking-wider mb-3">Potential Pain Points</h3>
              <ul className="space-y-2">
                {research.potentialPainPoints.map((pain, i) => (
                  <li key={i} className="text-sm text-orange-900 flex items-start gap-2">
                    <span className="text-orange-500 font-bold mt-0.5">•</span>
                    <span>{pain}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Outreach Angle */}
          {research.outreachAngle && (
            <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
              <h3 className="text-xs font-bold text-indigo-700 uppercase tracking-wider mb-2">Outreach Angle</h3>
              <p className="text-sm text-indigo-900 italic">{research.outreachAngle}</p>
            </div>
          )}

          {/* Personalized Hooks */}
          {research.personalizedHooks && research.personalizedHooks.length > 0 && (
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <h3 className="text-xs font-bold text-green-700 uppercase tracking-wider mb-3">Personalized Hooks</h3>
              <ul className="space-y-2">
                {research.personalizedHooks.map((hook, i) => (
                  <li key={i} className="text-sm text-green-900 flex items-start gap-2">
                    <span className="text-green-600 font-bold mt-0.5">→</span>
                    <span>{hook}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Key People */}
          {research.keyPeople && research.keyPeople.length > 0 && (
            <div className="bg-cyan-50 p-4 rounded-lg border border-cyan-200">
              <h3 className="text-xs font-bold text-cyan-700 uppercase tracking-wider mb-3">Key People</h3>
              <div className="flex flex-wrap gap-2">
                {research.keyPeople.map((person, i) => (
                  <span key={i} className="px-3 py-1 bg-white text-cyan-700 border border-cyan-300 rounded-full text-xs font-semibold">
                    {person}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recent Triggers */}
          {research.recentTriggers && research.recentTriggers.length > 0 && (
            <div className="bg-red-50 p-4 rounded-lg border border-red-200">
              <h3 className="text-xs font-bold text-red-700 uppercase tracking-wider mb-3">Recent Triggers 🔥</h3>
              <ul className="space-y-2">
                {research.recentTriggers.map((trigger, i) => (
                  <li key={i} className="text-sm text-red-900 flex items-start gap-2">
                    <span className="text-red-600 font-bold mt-0.5">!</span>
                    <span>{trigger}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* News Articles */}
          {research.newsArticles && research.newsArticles.length > 0 && (
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Globe className="w-4 h-4" /> News Articles
              </h3>
              <div className="space-y-2">
                {research.newsArticles.map((article, i) => (
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

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4 text-xs text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200">
            {research.websiteScrapedAt && (
              <div>
                <span className="font-semibold">Website Scraped:</span> {new Date(research.websiteScrapedAt).toLocaleDateString()}
              </div>
            )}
            {research.newsFoundAt && (
              <div>
                <span className="font-semibold">News Found:</span> {new Date(research.newsFoundAt).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>

        {/* Close Button */}
        <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 p-4 rounded-b-2xl flex justify-end">
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
