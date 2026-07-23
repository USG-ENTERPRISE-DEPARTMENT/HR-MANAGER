const { prisma } = require('../lib/prisma');
const { Prisma } = require('@prisma/client'); // Prisma.sql for portable parameterized raw queries

/***********************************************************************************************************
 * Prisma-based helper functions
 * 
 * It includes helper functions such as:
 * - checkForNullOrEmpty: validating null or empty data
 * - isAuthUser: checking if user is logged in
 * - checkUniqueColumn: checking for unique values in tables
 * - dynamicInsert: handles insertion with Prisma
 * - dynamicUpdate: handles updates with Prisma
 * - selectRecordsWithCondition: select records based on conditions
 * - deleteRecordsWithCondition: delete records based on conditions
 * - selectRecordsWithQuery: execute raw SQL queries
 ***************************************************************************************************************/

/**
 * Check for null or empty variables
 * @param {Array} data - Array of objects with name and value properties
 * @returns {Object} Status object
 */
function checkForNullOrEmpty(data) {
  const nullVariables = data.filter(({ value }) => value === null);
  const undefinedVariables = data.filter(({ value }) => value === undefined);
  const emptyStringVariables = data.filter(({ value }) => value === "");
  const whitespaceStringVariables = data.filter(
    ({ value }) => typeof value === "string" && value.trim() === ""
  );

  if (
    nullVariables.length > 0 ||
    undefinedVariables.length > 0 ||
    emptyStringVariables.length > 0 ||
    whitespaceStringVariables.length > 0
  ) {
    const nullErrorMessage = nullVariables
      .map(({ name }) => `${name} cannot be null`)
      .join(", ");
    const undefinedErrorMessage = undefinedVariables
      .map(({ name }) => `${name} cannot be undefined`)
      .join(", ");
    const emptyStringErrorMessage = emptyStringVariables
      .map(({ name }) => `${name} cannot be empty`)
      .join(", ");
    const whitespaceStringErrorMessage = whitespaceStringVariables
      .map(({ name }) => `${name} cannot be whitespace only`)
      .join(", ");

    const errorMessage = `${nullErrorMessage}${
      nullErrorMessage &&
      (undefinedErrorMessage ||
        emptyStringErrorMessage ||
        whitespaceStringErrorMessage)
        ? ", "
        : ""
    }${undefinedErrorMessage}${
      undefinedErrorMessage &&
      (emptyStringErrorMessage || whitespaceStringErrorMessage)
        ? ", "
        : ""
    }${emptyStringErrorMessage}${
      emptyStringErrorMessage && whitespaceStringErrorMessage ? ", " : ""
    }${whitespaceStringErrorMessage}`;

    return {
      status: "error",
      message: `Null, undefined, empty, or whitespace-only variables found: ${errorMessage}`,
      values: nullVariables.concat(
        undefinedVariables,
        emptyStringVariables,
        whitespaceStringVariables
      ),
    };
  } else {
    return {
      status: "success",
      message: "No null, undefined, empty, or whitespace-only variables",
    };
  }
}

// ─────────────────────────────────────────────
// Shared helper: safely convert a value to BigInt
// Returns null if the value is missing or non-numeric
// ─────────────────────────────────────────────
function safeBigInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || isNaN(n)) return null;
  return BigInt(Math.round(n));
}

// Sanitize an array of IDs — removes anything that can't become a valid BigInt
function sanitizeIds(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((v) => safeBigInt(v))
    .filter((v) => v !== null);
}

/**
 * Checks if a value exists in specified columns of a table using Prisma
 * @param {string} modelName - Name of the Prisma model (e.g., 'user', 'requestDocument')
 * @param {Object} whereConditions - Object with column-value pairs to check
 * @returns {Promise<Object>} Object containing status and message
 * 
 * @example
 * // Check single column
 * await checkUniqueColumn('user', { email: 'test@example.com' })
 * 
 * // Check multiple columns (OR condition)
 * await checkUniqueColumn('user', { 
 *   OR: [
 *     { email: 'test@example.com' },
 *     { phone: '1234567890' }
 *   ]
 * })
 */
const checkUniqueColumn = async (modelName, whereConditions) => {
  try {
    const model = prisma[modelName];
    
    if (!model) {
      return {
        status: "error",
        message: `Model ${modelName} not found in Prisma schema`
      };
    }

    const existingRecords = await model.findMany({
      where: whereConditions
    });

    if (existingRecords.length === 0) {
      return {
        status: "success",
        message: "Value is unique"
      };
    } else {
      // Build friendly error messages
      let duplicateMessages = [];
      
      if (whereConditions.OR) {
        // Check each condition
        whereConditions.OR.forEach(condition => {
          const field = Object.keys(condition)[0];
          const value = condition[field];
          
          // Check if any record has this exact value
          const matchingRecord = existingRecords.find(record => record[field] === value);
          if (matchingRecord) {
            // Create user-friendly field names
            const friendlyFieldName = field.replace(/_/g, ' ').toLowerCase();
            duplicateMessages.push(`This ${friendlyFieldName} (${value}) is already registered`);
          }
        });
      } else {
        // Handle single condition
        Object.keys(whereConditions).forEach(field => {
          const value = whereConditions[field];
          const friendlyFieldName = field
            .replace(/_/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
          
          duplicateMessages.push(`${friendlyFieldName} "${value}" is already registered`);
        });
      }

      return {
        status: "error",
        message: duplicateMessages.join('. '),
        duplicates: existingRecords
      };
    }
  } catch (error) {
    console.error("Error checking unique column:", error);
    return {
      status: "error",
      message: `Failed to check unique value: ${error.message}`,
      error: error.message
    };
  }
};

/**
 * Select records from a table based on conditions
 * @param {string} modelName - Name of the Prisma model
 * @param {Object} whereConditions - Prisma where conditions
 * @param {Object} options - Additional Prisma options (select, include, orderBy, etc.)
 * @returns {Promise<Object>} Object containing status and data
 * 
 * @example
 * await selectRecordsWithCondition('user', { email: 'test@example.com' })
 * await selectRecordsWithCondition('user', { status: '1' }, { 
 *   select: { id: true, email: true, first_name: true }
 * })
 */
const selectRecordsWithCondition = async (modelName, whereConditions, options = {}) => {
  try {
    const model = prisma[modelName];

    if (!model) {
      return {
        status: "error",
        message: `Model ${modelName} not found in Prisma schema`,
        data: []
      };
    }

    const records = await model.findMany({
      where: whereConditions,
      ...options
    });

    // Convert BigInt → Number via a direct walk (NOT JSON.stringify: a global
    // BigInt.prototype.toJSON in app.js would emit bigints as strings, breaking `col = ?`
    // comparisons against bigint columns on Postgres — e.g. role.id used as rhp.role_id = ?).
    const conv = (v) => {
      if (typeof v === 'bigint') return Number(v);
      if (v instanceof Date) return v.toISOString();
      if (Array.isArray(v)) return v.map(conv);
      if (v !== null && typeof v === 'object') {
        if (v.constructor?.name === 'Decimal' || typeof v.toFixed === 'function') return Number(v.toString());
        const o = {};
        for (const [k, val] of Object.entries(v)) o[k] = conv(val);
        return o;
      }
      return v;
    };
    const serializedRecords = (records || []).map(conv);

    if (serializedRecords.length === 0) {
      return {
        status: "error",
        message: "No data found",
        data: []
      };
    } else {
      return {
        status: "success",
        data: serializedRecords,
        count: serializedRecords.length
      };
    }
  } catch (error) {
    console.error("Error selecting records:", error);
    return {
      status: "error",
      message: `Failed to select records: ${error.message}`,
      data: [],
      error: error.message
    };
  }
};

/**
 * Checks if a user is logged in
 * @param {number} userId - User ID to check
 * @returns {Promise<boolean>} True if logged in, false otherwise
 */
const isAuthUser = async (userId) => {
  try {
    const user = await prisma.loggedInUsers.findUnique({
      where: { userId: userId }
    });

    return !!user; // Returns true if user exists, false otherwise
  } catch (error) {
    console.error("Error checking if user is logged in:", error);
    return false;
  }
};

/**
 * Dynamically inserts data into any Prisma model
 * @param {string} modelName - Name of the Prisma model
 * @param {Object} data - Data object to be inserted
 * @returns {Promise<Object>} The created record
 * 
 * @example
 * await dynamicInsert('user', {
 *   first_name: 'John',
 *   last_name: 'Doe',
 *   email: 'john@example.com'
 * })
 */
async function dynamicInsert(modelName, data) {
  try {
    const model = prisma[modelName];
    
    if (!model) {
      return {
        status: "error",
        message: `Model ${modelName} not found in Prisma schema`
      };
    }

    const result = await model.create({
      data: data
    });

    return {
      status: "success",
      message: "Data inserted successfully",
      data: result
    };
  } catch (error) {
    console.error(`Error in dynamicInsert for ${modelName}:`, error);
    return {
      status: "error",
      message: `Failed to insert data: ${error.message}`,
      error: error.message
    };
  }
}

/**
 * Dynamically updates data in any Prisma model by ID
 * @param {string} modelName - Name of the Prisma model
 * @param {Object} data - Data object containing fields to be updated
 * @param {number|string} id - ID of the record to update
 * @param {string} idField - Name of the ID field (defaults to 'id')
 * @returns {Promise<Object>} Result of the update operation
 * 
 * @example
 * await dynamicUpdateWithId('user', { status: '1' }, 5)
 * await dynamicUpdateWithId('requestDocument', { status: 'APPROVED' }, 'DOC123', 'doc_id')
 */
async function dynamicUpdateWithId(modelName, data, id, idField = 'id') {
  try {
    const model = prisma[modelName];
    
    if (!model) {
      return {
        status: "error",
        message: `Model ${modelName} not found in Prisma schema`
      };
    }

    const result = await model.update({
      where: { [idField]: id },
      data: data
    });

    return {
      status: "success",
      message: "Data updated successfully",
      data: result
    };
  } catch (error) {
    // Handle record not found error
    if (error.code === 'P2025') {
      return {
        status: "error",
        message: `No record found with ${idField} = ${id}`,
        affectedRows: 0
      };
    }

    console.error(`Error in dynamicUpdateWithId for ${modelName}:`, error);
    return {
      status: "error",
      message: `Failed to update data: ${error.message}`,
      error: error.message
    };
  }
}

/**
 * Delete records from a Prisma model based on conditions
 * @param {string} modelName - Name of the Prisma model
 * @param {Object} whereConditions - Prisma where conditions
 * @returns {Promise<Object>} Object containing status and count
 * 
 * @example
 * await deleteRecordsWithCondition('user', { id: 5 })
 * await deleteRecordsWithCondition('loggedInUsers', { userId: 10 })
 */
const deleteRecordsWithCondition = async (modelName, whereConditions) => {
  try {
    const model = prisma[modelName];
    
    if (!model) {
      return {
        status: "error",
        message: `Model ${modelName} not found in Prisma schema`,
        deletedCount: 0
      };
    }

    const result = await model.deleteMany({
      where: whereConditions
    });

    if (result.count === 0) {
      return {
        status: "error",
        message: "No matching records found to delete",
        deletedCount: 0
      };
    } else {
      return {
        status: "success",
        message: `Successfully deleted ${result.count} record(s)`,
        deletedCount: result.count
      };
    }
  } catch (error) {
    console.error("Error in deleteRecordsWithCondition:", error);
    return {
      status: "error",
      message: `Failed to delete records: ${error.message}`,
      deletedCount: 0,
      error: error.message
    };
  }
};

/**
 * Execute a raw SQL query (for complex queries not easily done with Prisma)
 * @param {string} query - The SQL query to execute
 * @param {Array} params - Array of parameter values (Prisma uses $1, $2, etc.)
 * @returns {Promise<Object>} Object containing status and data
 * 
 * @example
 * await selectRecordsWithQuery('SELECT * FROM users WHERE email = ?', ['test@example.com'])
 */
/**
 * Execute a raw SQL query (for complex queries not easily done with Prisma)
 * @param {string} query - The SQL query to execute (use $1, $2, $3 for PostgreSQL parameters)
 * @param {Array} params - Array of parameter values
 * @returns {Promise<Object>} Object containing status and data
 * 
 * @example
 * await selectRecordsWithQuery('SELECT * FROM users WHERE email = $1', ['test@example.com'])
 * await selectRecordsWithQuery('SELECT * FROM users WHERE id = $1 AND status = $2', [5, '1'])
 */
const selectRecordsWithQuery = async (query, params = []) => {
  try {
    console.log("Executing query:", query);
    console.log("With parameters:", params);

    // Portable: rebuild the `?`-placeholder string into a Prisma.sql fragment so Prisma emits the
    // correct placeholder per provider (MySQL `?`, Postgres `$1`…). Splitting on `?` mirrors the old
    // $queryRawUnsafe(query, ...params) semantics (every `?` is a positional bind). Keeps the
    // (queryString, paramsArray) API so all ~40 call sites remain unchanged.
    const results = await prisma.$queryRaw(Prisma.sql(String(query).split('?'), ...params));

    // Convert BigInt → Number and normalise lower-cased Postgres result keys → camelCase field
    // names (no-op on MySQL). Done with a direct recursive walk rather than JSON.stringify: a global
    // `BigInt.prototype.toJSON` (set in app.js) makes JSON.stringify emit bigints as STRINGS, which
    // then break `col = ?` / `IN (?)` comparisons against bigint columns on Postgres.
    const { fieldFor } = require('./pgKeyMap');
    const conv = (v) => {
      if (typeof v === 'bigint') return Number(v);
      if (v instanceof Date) return v.toISOString();
      if (Array.isArray(v)) return v.map(conv);
      if (v !== null && typeof v === 'object') {
        if (v.constructor?.name === 'Decimal' || typeof v.toFixed === 'function') return Number(v.toString());
        const o = {};
        for (const [k, val] of Object.entries(v)) o[fieldFor(k)] = conv(val);
        return o;
      }
      return v;
    };
    const serializedResults = (results || []).map(conv);

    if (serializedResults.length === 0) {
      return {
        status: "success",
        message: "No records found",
        data: []
      };
    } else {
      return {
        status: "success",
        message: "Records retrieved successfully",
        data: serializedResults,
        count: serializedResults.length
      };
    }
  } catch (error) {
    console.error("Error in selectRecordsWithQuery:", error);
    return {
      status: "error",
      message: `Failed to execute query: ${error.message}`,
      data: [],
      error: error.message
    };
  }
};

/**
 * Execute a transaction with multiple operations
 * @param {Function} callback - Async function that receives Prisma transaction client
 * @returns {Promise<Object>} Result of the transaction
 * 
 * @example
 * await executeTransaction(async (tx) => {
 *   const user = await tx.user.create({ data: { ... } });
 *   const doc = await tx.requestDocument.create({ data: { user_id: user.id } });
 *   return { user, doc };
 * })
 */
const executeTransaction = async (callback) => {
  try {
    const result = await prisma.$transaction(callback);
    return {
      status: "success",
      message: "Transaction completed successfully",
      data: result
    };
  } catch (error) {
    console.error("Error in transaction:", error);
    return {
      status: "error",
      message: `Transaction failed: ${error.message}`,
      error: error.message
    };
  }
};

module.exports = {
  checkForNullOrEmpty,
  checkUniqueColumn,
  isAuthUser,
  selectRecordsWithCondition,
  deleteRecordsWithCondition,
  dynamicInsert,
  selectRecordsWithQuery,
  dynamicUpdateWithId,
  executeTransaction,
  safeBigInt,
  sanitizeIds,
  prisma // Export prisma instance for direct usage
};