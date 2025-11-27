
import { Lead, LeadStatus } from '../types';
import { v4 as uuidv4 } from 'uuid';

export const MOCK_LEADS: Lead[] = [
    {
        id: uuidv4(),
        companyName: "Apex Logistics Solutions",
        website: "https://apexlogistics.example.com",
        description: "Regional freight forwarding and dispatch services for the Midwest.",
        status: LeadStatus.QUALIFIED,
        createdAt: Date.now(),
        lastUpdated: Date.now(),
        foundVia: "Logistics Demo",
        analysis: {
            score: 85,
            reasoning: "High manual friction detected. Website mentions 'Call to book' and 'Fax forms'. Perfect candidate for automated dispatch.",
            suggestedAngle: "Automate Dispatch",
            painPoints: ["Manual Booking", "Paper Trails", "Phone Tag"],
            budgetEstimate: "$3k/mo",
            employeeSentiment: "Negative (Overworked dispatchers)",
            competitors: ["Flexport"]
        },
        decisionMaker: {
            name: "Robert Stone",
            role: "Operations Director",
            email: "rob@apexlogistics.example.com"
        },
        triggers: [{ type: 'hiring', description: "Hiring 2 Dispatchers", sourceUrl: "" }],
        techStack: ["WordPress", "Gravity Forms"],
        emailSequence: [
            {
                subject: "Question about your dispatch flow",
                body: "Hi Robert,\n\nI saw you're hiring dispatchers. Instead of adding headcount, have you considered automating the intake process?\n\nWe helped a similar logistics firm save 15hrs/week.",
                delayDays: 0,
                context: "Hook",
                variantLabel: 'A',
                critique: "Focused on hiring pain."
            }
        ]
    },
    {
        id: uuidv4(),
        companyName: "Miller & Associates Law",
        website: "https://millerlaw.example.com",
        description: "Boutique family law firm specializing in estate planning.",
        status: LeadStatus.NEW,
        createdAt: Date.now(),
        lastUpdated: Date.now(),
        foundVia: "Legal Demo",
        analysis: {
            score: 92,
            reasoning: "Excellent fit. High value per hour, lots of document review. They use an old clunky site.",
            suggestedAngle: "Document Review AI",
            painPoints: ["Contract Review", "Client Onboarding"],
            budgetEstimate: "$5k/mo"
        },
        techStack: ["Clio", "Microsoft Office"]
    }
];
