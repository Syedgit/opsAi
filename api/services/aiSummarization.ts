import OpenAI from 'openai';
import { PrismaClient } from '@prisma/client';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, format } from 'date-fns';

const prisma = new PrismaClient();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Use gpt-4o if available, fallback to gpt-3.5-turbo
// You can override via OPENAI_MODEL env var (e.g., OPENAI_MODEL=gpt-3.5-turbo)
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

export interface BusinessSummary {
  period: string;
  sales: {
    total: number;
    cash: number;
    card: number;
    count: number;
    average: number;
  };
  expenses: {
    total: number;
    count: number;
    topCategories: Array<{ category: string; amount: number }>;
  };
  fuel: {
    totalSales: number;
    totalGallons: number;
    averageGp: number;
  };
  insights: string[];
  recommendations: string[];
  trends: {
    salesTrend: 'up' | 'down' | 'stable';
    expenseTrend: 'up' | 'down' | 'stable';
  };
}

/**
 * Generate AI-powered business summary for a store
 */
export async function generateBusinessSummary(
  storeId: string,
  period: 'today' | 'week' | 'month',
  customDate?: Date
): Promise<BusinessSummary> {
  try {
    const date = customDate || new Date();
    let start: Date, end: Date, periodLabel: string;

    switch (period) {
      case 'today':
        start = startOfDay(date);
        end = endOfDay(date);
        periodLabel = format(date, 'MMMM dd, yyyy');
        break;
      case 'week':
        start = startOfWeek(date);
        end = endOfWeek(date);
        periodLabel = `Week of ${format(start, 'MMM dd')} - ${format(end, 'MMM dd, yyyy')}`;
        break;
      case 'month':
        start = startOfMonth(date);
        end = endOfMonth(date);
        periodLabel = format(date, 'MMMM yyyy');
        break;
    }

    // Fetch data from database
    const [sales, expenses, fuel, paidouts] = await Promise.all([
      prisma.pendingActions.findMany({
        where: {
          storeId,
          type: 'STORE_SALES',
          status: 'CONFIRMED',
          createdAt: { gte: start, lte: end },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.pendingActions.findMany({
        where: {
          storeId,
          type: 'INVOICE_EXPENSE',
          status: 'CONFIRMED',
          createdAt: { gte: start, lte: end },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.pendingActions.findMany({
        where: {
          storeId,
          type: 'FUEL_SALES',
          status: 'CONFIRMED',
          createdAt: { gte: start, lte: end },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.pendingActions.findMany({
        where: {
          storeId,
          type: 'PAID_OUT',
          status: 'CONFIRMED',
          createdAt: { gte: start, lte: end },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Calculate basic stats
    const salesData = sales.map((s) => s.payloadJson as any);
    const totalSales = salesData.reduce((sum, s) => sum + (s.total_inside || 0), 0);
    const cashSales = salesData.reduce((sum, s) => sum + (s.cash || 0), 0);
    const cardSales = salesData.reduce((sum, s) => sum + (s.card || 0), 0);

    const expenseData = expenses.map((e) => e.payloadJson as any);
    const totalExpenses = expenseData.reduce((sum, e) => sum + (e.amount || 0), 0);

    const fuelData = fuel.map((f) => f.payloadJson as any);
    const totalFuelSales = fuelData.reduce((sum, f) => sum + (f.fuel_sales || 0), 0);
    const totalGallons = fuelData.reduce((sum, f) => sum + (f.gallons || 0), 0);
    const avgFuelGp = fuelData.length > 0
      ? fuelData.reduce((sum, f) => sum + (f.fuel_gp || 0), 0) / fuelData.length
      : 0;

    // Calculate expense categories
    const categoryMap = new Map<string, number>();
    expenseData.forEach((e) => {
      const cat = e.category || 'Other';
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + (e.amount || 0));
    });
    const topCategories = Array.from(categoryMap.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // Get previous period for comparison
    const prevStart = new Date(start);
    const prevEnd = new Date(end);
    const periodDiff = end.getTime() - start.getTime();
    prevStart.setTime(prevStart.getTime() - periodDiff);
    prevEnd.setTime(prevEnd.getTime() - periodDiff);

    const [prevSales, prevExpenses] = await Promise.all([
      prisma.pendingActions.findMany({
        where: {
          storeId,
          type: 'STORE_SALES',
          status: 'CONFIRMED',
          createdAt: { gte: prevStart, lte: prevEnd },
        },
      }),
      prisma.pendingActions.findMany({
        where: {
          storeId,
          type: 'INVOICE_EXPENSE',
          status: 'CONFIRMED',
          createdAt: { gte: prevStart, lte: prevEnd },
        },
      }),
    ]);

    const prevSalesTotal = prevSales.reduce(
      (sum, s) => sum + ((s.payloadJson as any).total_inside || 0),
      0
    );
    const prevExpensesTotal = prevExpenses.reduce(
      (sum, e) => sum + ((e.payloadJson as any).amount || 0),
      0
    );

    // Determine trends
    const salesTrend =
      totalSales > prevSalesTotal * 1.05 ? 'up' : totalSales < prevSalesTotal * 0.95 ? 'down' : 'stable';
    const expenseTrend =
      totalExpenses > prevExpensesTotal * 1.05 ? 'up' : totalExpenses < prevExpensesTotal * 0.95 ? 'down' : 'stable';

    // Helper function to generate fallback insights
    function generateFallbackInsights(
      dataSummary: {
        sales: { total: number; cash: number; card: number; count: number };
        expenses: { total: number; topCategories: Array<{ category: string; amount: number }> };
        fuel: { totalSales: number; averageGp: number };
      },
      salesTrend: 'up' | 'down' | 'stable',
      expenseTrend: 'up' | 'down' | 'stable'
    ): { insights: string[]; recommendations: string[] } {
      const insights: string[] = [];
      const recommendations: string[] = [];

      // Sales insights
      if (dataSummary.sales.count > 0) {
        const avgSale = dataSummary.sales.total / dataSummary.sales.count;
        if (avgSale > 100) {
          insights.push(`Average transaction value is $${avgSale.toFixed(2)}, indicating strong customer spending`);
        }
        
        const cardRatio = dataSummary.sales.card / dataSummary.sales.total;
        if (cardRatio > 0.6) {
          insights.push(`Card payments represent ${(cardRatio * 100).toFixed(0)}% of sales, showing modern payment preferences`);
        }
      }

      // Trend insights
      if (salesTrend === 'up') {
        insights.push('Sales are trending upward compared to the previous period');
        recommendations.push('Maintain current strategies that are driving growth');
      } else if (salesTrend === 'down') {
        insights.push('Sales have decreased compared to the previous period');
        recommendations.push('Review marketing and promotional strategies to boost sales');
      }

      // Expense insights
      if (dataSummary.expenses.topCategories.length > 0) {
        const topCategory = dataSummary.expenses.topCategories[0];
        insights.push(`Top expense category is ${topCategory.category} at $${topCategory.amount.toFixed(2)}`);
        recommendations.push(`Review ${topCategory.category} expenses for potential cost optimization`);
      }

      if (expenseTrend === 'up') {
        recommendations.push('Monitor expense increases and identify areas for cost control');
      }

      // Fuel insights
      if (dataSummary.fuel.totalSales > 0 && dataSummary.fuel.averageGp > 0) {
        insights.push(`Fuel operations show an average GP of $${dataSummary.fuel.averageGp.toFixed(2)} per transaction`);
        if (dataSummary.fuel.averageGp < 0.15) {
          recommendations.push('Consider reviewing fuel pricing strategy to improve margins');
        }
      }

      // Default insights if none generated
      if (insights.length === 0) {
        insights.push('Review sales patterns for optimization opportunities');
      }
      if (recommendations.length === 0) {
        recommendations.push('Continue monitoring daily performance metrics');
        recommendations.push('Focus on maintaining consistent operations');
      }

      return { insights, recommendations };
    }

    // Prepare data summary for fallback
    const dataSummary = {
      sales: {
        total: totalSales,
        cash: cashSales,
        card: cardSales,
        count: sales.length,
      },
      expenses: {
        total: totalExpenses,
        topCategories,
      },
      fuel: {
        totalSales: totalFuelSales,
        averageGp: avgFuelGp,
      },
    };

    // Generate AI insights and recommendations
    const aiPrompt = `You are a business analyst for a convenience store. Analyze this data and provide:

1. 2-3 key insights (what stands out, trends, patterns)
2. 2-3 actionable recommendations (what to focus on, areas for improvement)

Data Summary:
- Period: ${periodLabel}
- Sales: ${sales.length} entries, Total: $${totalSales.toFixed(2)} (Cash: $${cashSales.toFixed(2)}, Card: $${cardSales.toFixed(2)})
- Previous Period Sales: $${prevSalesTotal.toFixed(2)}
- Expenses: ${expenses.length} entries, Total: $${totalExpenses.toFixed(2)}
- Top Expense Categories: ${topCategories.map((c) => `${c.category}: $${c.amount.toFixed(2)}`).join(', ')}
- Fuel: ${fuel.length} entries, Sales: $${totalFuelSales.toFixed(2)}, Gallons: ${totalGallons.toFixed(0)}, Avg GP: $${avgFuelGp.toFixed(2)}
- Paid Outs: ${paidouts.length} entries

Return JSON format:
{
  "insights": ["insight 1", "insight 2", "insight 3"],
  "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3"]
}`;

    // Generate AI insights with fallback to basic insights
    let aiData: { insights?: string[]; recommendations?: string[] } = {};
    
    try {
      const aiResponse = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You are a business analyst. Provide concise, actionable insights and recommendations. Return only valid JSON.',
          },
          { role: 'user', content: aiPrompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const aiContent = aiResponse.choices[0]?.message?.content || '{}';
      
      try {
        const jsonMatch = aiContent.match(/```json\s*([\s\S]*?)\s*```/) || 
                         aiContent.match(/```\s*([\s\S]*?)\s*```/) ||
                         [null, aiContent];
        aiData = JSON.parse(jsonMatch[1] || aiContent.trim());
      } catch (parseError) {
        console.warn('Failed to parse AI response, using defaults', { parseError });
        aiData = generateFallbackInsights(dataSummary, salesTrend, expenseTrend);
      }
    } catch (openaiError: any) {
      // Handle OpenAI API errors (quota exceeded, rate limits, etc.)
      const errorMessage = openaiError?.message || 'Unknown error';
      const errorStatus = openaiError?.status || openaiError?.response?.status;
      
      // Log at debug level for quota/rate limit errors (expected), warn for other errors
      if (errorStatus === 429) {
        // Quota exceeded is expected - silently use fallback
        console.debug('OpenAI API quota exceeded, using fallback insights', { 
          storeId,
          period 
        });
      } else {
        console.warn('OpenAI API error, using fallback insights', { 
          error: errorMessage, 
          status: errorStatus,
          storeId,
          period 
        });
      }
      
      // Generate fallback insights based on data
      aiData = generateFallbackInsights(dataSummary, salesTrend, expenseTrend);
    }

    return {
      period: periodLabel,
      sales: {
        total: totalSales,
        cash: cashSales,
        card: cardSales,
        count: sales.length,
        average: sales.length > 0 ? totalSales / sales.length : 0,
      },
      expenses: {
        total: totalExpenses,
        count: expenses.length,
        topCategories,
      },
      fuel: {
        totalSales: totalFuelSales,
        totalGallons: totalGallons,
        averageGp: avgFuelGp,
      },
      insights: aiData.insights || [],
      recommendations: aiData.recommendations || [],
      trends: {
        salesTrend,
        expenseTrend,
      },
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to generate business summary', {
      error: errorMessage,
      storeId,
      period,
    });
    throw error;
  }
}

/**
 * Generate WhatsApp-friendly summary message
 */
export async function generateWhatsAppSummary(
  storeId: string,
  period: 'today' | 'week' | 'month'
): Promise<string> {
  try {
    const summary = await generateBusinessSummary(storeId, period);

    let message = `📊 ${summary.period} Summary\n\n`;
    message += `💰 Sales: $${summary.sales.total.toFixed(2)}\n`;
    message += `   Cash: $${summary.sales.cash.toFixed(2)} | Card: $${summary.sales.card.toFixed(2)}\n`;
    message += `   Entries: ${summary.sales.count}\n\n`;
    
    message += `💸 Expenses: $${summary.expenses.total.toFixed(2)}\n`;
    message += `   Entries: ${summary.expenses.count}\n`;
    if (summary.expenses.topCategories.length > 0) {
      message += `   Top: ${summary.expenses.topCategories[0].category} ($${summary.expenses.topCategories[0].amount.toFixed(2)})\n`;
    }
    message += `\n`;

    if (summary.fuel.totalSales > 0) {
      message += `⛽ Fuel: $${summary.fuel.totalSales.toFixed(2)}\n`;
      message += `   Gallons: ${summary.fuel.totalGallons.toFixed(0)}\n`;
      message += `   Avg GP: $${summary.fuel.averageGp.toFixed(2)}\n\n`;
    }

    message += `📈 Trends:\n`;
    message += `   Sales: ${summary.trends.salesTrend === 'up' ? '📈 Up' : summary.trends.salesTrend === 'down' ? '📉 Down' : '➡️ Stable'}\n`;
    message += `   Expenses: ${summary.trends.expenseTrend === 'up' ? '📈 Up' : summary.trends.expenseTrend === 'down' ? '📉 Down' : '➡️ Stable'}\n\n`;

    if (summary.insights.length > 0) {
      message += `💡 Insights:\n`;
      summary.insights.forEach((insight) => {
        message += `   • ${insight}\n`;
      });
      message += `\n`;
    }

    if (summary.recommendations.length > 0) {
      message += `🎯 Recommendations:\n`;
      summary.recommendations.forEach((rec) => {
        message += `   • ${rec}\n`;
      });
    }

    return message;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to generate WhatsApp summary', {
      error: errorMessage,
      storeId,
      period,
    });
    throw error;
  }
}
