'use client';

import { useState } from 'react';
import ExpenseTypeSelect from '../components/ExpenseTypeSelect';
import { CardBrand, Expense, ExpenseForm, ExpenseSubtypes, Subtype } from '../types';

export default function AddExpense({ onExpenseAdded }: { onExpenseAdded: () => void }) {
  const [expense, setExpense] = useState<ExpenseForm>({
    name: '',
    value: '',
    type: '',
    subtype: '',
    paymentType: '',
    cardBrand: undefined,
    date: '',
    installments: 1
  });

  const generateExpenseData = async function (expense: ExpenseForm): Promise<Expense[]> {
    const isCredit = expense.paymentType === 'credit';
    const iterations = isCredit ? (expense.installments ?? 1) : 1;
    const expenses: Expense[] = [];

    const transactionId = crypto.randomUUID();

    // For each installment, create an expense object and add to the array of expenses
    for (let i = 1; i <= iterations; i++) {
      const purchaseDate = new Date(`${expense.date}T12:00:00Z`);
      purchaseDate.setUTCMonth(purchaseDate.getUTCMonth() + (i - 1));
      const dateString = purchaseDate.toISOString().split('T')[0];

      let effectiveDateString = dateString;

      if (isCredit && expense.cardBrand) {
        const month = purchaseDate.getUTCMonth() + 1;
        const year = purchaseDate.getUTCFullYear();

        // Fetch the billing cycle to know the closing date
        const res = await fetch(`/api/card-cycles?brand=${expense.cardBrand}&month=${month}&year=${year}`);
        const cycle = await res.json();

        // Ensure we compare ONLY the date parts (YYYY-MM-DD)
        // cycle.closingDate could be a string or an ISO object from MongoDB
        const closingDateStr = typeof cycle.closingDate === 'string' 
          ? cycle.closingDate.split('T')[0] 
          : new Date(cycle.closingDate).toISOString().split('T')[0];

        // Comparison using strings is safe for YYYY-MM-DD
        if (dateString > closingDateStr) {         
          // Move to NEXT month
          const nextMonthDate = new Date(purchaseDate);
          nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
          
          const nMonth = nextMonthDate.getUTCMonth() + 1;
          const nYear = nextMonthDate.getUTCFullYear();

          const resNext = await fetch(`/api/card-cycles?brand=${expense.cardBrand}&month=${nMonth}&year=${nYear}`);
          const nextCycle = await resNext.json();
          
          // Use the dueDate of the NEXT month
          const rawDueDate = nextCycle.dueDate;
          effectiveDateString = typeof rawDueDate === 'string' 
            ? rawDueDate.split('T')[0] 
            : new Date(rawDueDate).toISOString().split('T')[0];
        } else {
          // Stays in current month
          const rawDueDate = cycle.dueDate;
          effectiveDateString = typeof rawDueDate === 'string' 
            ? rawDueDate.split('T')[0] 
            : new Date(rawDueDate).toISOString().split('T')[0];
        }
      }

      const common = {
        name: expense.name,
        type: expense.type as keyof typeof ExpenseSubtypes,
        subtype: expense.subtype as Subtype,
        date: dateString,
        effectiveDate: effectiveDateString,
        transactionId: isCredit ? transactionId : undefined
      };

      let expenseData: Expense;
      if (expense.paymentType === 'credit') {
        expenseData = {
          ...common,
          value: expense.value === '' ? 0 : Math.round((expense.value / iterations) * 100) / 100,
          paymentType: 'credit',
          cardBrand: expense.cardBrand!,
          installment: i,
          totalInstallments: iterations
        };
      } else {
        expenseData = {
          ...common,
          value: expense.value === '' ? 0 : expense.value,
          paymentType: expense.paymentType as 'cash' | 'debit' | 'pix' | 'food-voucher' | 'meal-voucher' |'fuel-voucher',
        };
      }

      expenses.push(expenseData);
    }

    return expenses;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    setExpense((prev) => {
      switch (name) {
        case 'value':
          return { ...prev, value: value === '' ? '' : parseFloat(value) };
        
        case 'installments':
          return { ...prev, installments: value === '' ? undefined : parseInt(value) };
        
        case 'type':
          return { 
            ...prev, 
            type: value as keyof typeof ExpenseSubtypes | '', 
            subtype: '' 
          };
        
        case 'paymentType':
          return { 
            ...prev, 
            paymentType: value as ExpenseForm['paymentType'] 
          };
        
        case 'cardBrand':
          return { 
            ...prev, 
            cardBrand: value === '' ? undefined : (value as CardBrand) 
          };

        default:
          return { ...prev, [name]: value };
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (expense.paymentType === 'credit' && !expense.cardBrand) {
      alert("Favor passar as informações do cartão");
      return;
    }

    const expensesData: Expense[] = await generateExpenseData(expense)

    try {
      const requests = expensesData.map((expense: Expense) => 
        fetch('/api/expenses', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(expense),
            })
      )

      const responses = await Promise.all(requests)

      const responsesOK = responses.every(res => res.ok)

      if (responsesOK) {
        setExpense({
          name: '',
          value: 0,
          type: '',
          paymentType: '',
          cardBrand: undefined,
          date: '',
          installments: 1
        });
        onExpenseAdded();
      } else {
        console.error("Some requests failed");
        alert("Erro ao salvar algumas parcelas.");
      }
    } catch (error) {
      console.error("Network error:", error);
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 border rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-4">Novo Gasto</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-1">Nome</label>
          <input
            type="text"
            id="name"
            name="name"
            value={expense.name}
            onChange={handleChange}
            className="w-full p-2 border rounded"
            required
          />
        </div>
        <div>
          <label htmlFor="value" className="block text-sm font-medium mb-1">
            Valor
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <span className="text-gray-500">R$</span>
            </div>

            <input
              type="number"
              id="value"
              name="value"
              value={expense.value}
              onChange={handleChange}
              className="w-full p-2 pl-10 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              min="0"
              step="0.01"
              required
            />
          </div>
        </div>
        <div>
          <label htmlFor="type" className="block text-sm font-medium mb-1">Tipo</label>
          <ExpenseTypeSelect
            expense={expense}
            onChange={handleChange}
          />
        </div>
        <div>
          <label htmlFor="paymentType" className="block text-sm font-medium mb-1">Tipo de Pagamento</label>
          <select
            id="paymentType"
            name="paymentType"
            value={expense.paymentType}
            onChange={handleChange}
            className="w-full p-2 border rounded"
            required
          >
            <option value="">Selecione o tipo de pagamento</option>
            <option value="credit">Crédito</option>
            <option value="debit">Débito</option>
            <option value="cash">PIX</option>
            <option value="other">Dinheiro</option>
            <option value="food-voucher">Vale Alimentação</option>
            <option value="meal-voucher">Vale Refeição</option>
            <option value="fuel-voucher">Vale Combustível</option>
          </select>
        </div>
        {expense.paymentType === "credit" ? 
          (
            <div className="space-y-4">
              <div>
                <label htmlFor="installments" className="block text-sm font-medium mb-1">Número de Parcelas</label>
                <input
                  type="number"
                  id="installments"
                  name="installments"
                  value={expense.installments ?? ''}
                  onChange={handleChange}
                  className="w-full p-2 border rounded"
                  min="1"
                  required
                />
              </div>
              <div>
                <label htmlFor="cardBrand" className="block text-sm font-medium mb-1">Cartão Utilizado</label>
                <select
                  id="cardBrand"
                  name="cardBrand"
                  value={expense.cardBrand}
                  onChange={handleChange}
                  className="w-full p-2 border rounded"
                  required
                >
                  <option value="">Selecione o cartão utilizado</option>
                  {Object.entries(CardBrand).map(([key, value]) => (
                    <option key={key} value={value}>
                      {value}
                    </option>
                  ))}                
                </select>
              </div>
            </div>
          ) : null
        }
        <div>
          <label htmlFor="date" className="block text-sm font-medium mb-1">Data</label>
          <input
            type="date"
            id="date"
            name="date"
            value={expense.date}
            onChange={handleChange}
            className="w-full p-2 border rounded"
            required
          />
        </div>
        <button type="submit" className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600">
          Criar
        </button>
      </form>
    </div>
  );
}