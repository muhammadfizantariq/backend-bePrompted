import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const CONFIG = {
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
    dbName: process.env.DB_NAME || 'webdata',
    collectionName: process.env.COLLECTION_NAME || 'extractions_3',
    // Dynamic MongoDB connection options based on URI type
    get options() {
      const uri = this.uri;
      
      // For MongoDB Atlas (cloud) - use TLS options
      if (uri.includes('mongodb+srv://') || uri.includes('ssl=true')) {
        return {
          // TLS/SSL options for MongoDB connections
          tls: true,
          tlsAllowInvalidCertificates: true,
          tlsAllowInvalidHostnames: true,
          
          // Connection timeouts
          connectTimeoutMS: 30000,
          socketTimeoutMS: 30000,
          serverSelectionTimeoutMS: 30000,
          
          // Connection pool settings
          maxPoolSize: 10,
          minPoolSize: 5,
          
          // Retry settings
          retryWrites: true,
          retryReads: true,
          
          // Server selection
          heartbeatFrequencyMS: 10000
        };
      }
      
      // For local MongoDB - minimal options
      return {
        // Connection timeouts
        connectTimeoutMS: 30000,
        socketTimeoutMS: 30000,
        serverSelectionTimeoutMS: 30000,
        
        // Connection pool settings
        maxPoolSize: 10,
        minPoolSize: 5,
        
        // Retry settings
        retryWrites: true,
        retryReads: true
      };
    }
  }
};

async function testMongoDBConnection() {
  console.log('🧪 Testing MongoDB Connection...');
  console.log(`📡 URI: ${CONFIG.mongodb.uri}`);
  console.log(`🔌 Options:`, JSON.stringify(CONFIG.mongodb.options, null, 2));
  
  let client;
  try {
    console.log('\n🔌 Attempting to connect...');
    client = new MongoClient(CONFIG.mongodb.uri, CONFIG.mongodb.options);
    
    await client.connect();
    console.log('✅ MongoDB connection successful!');
    
    // Test database access
    const db = client.db(CONFIG.mongodb.dbName);
    console.log(`📂 Database '${CONFIG.mongodb.dbName}' accessible`);
    
    // Test collection access
    const collection = db.collection(CONFIG.mongodb.collectionName);
    const count = await collection.countDocuments();
    console.log(`📊 Collection '${CONFIG.mongodb.collectionName}' has ${count} documents`);
    
    // Test ping
    await db.admin().ping();
    console.log('🏓 MongoDB ping successful');
    
    console.log('\n🎉 All MongoDB tests passed!');
    
  } catch (error) {
    console.error('\n❌ MongoDB connection failed:');
    console.error(`   Error: ${error.message}`);
    console.error(`   Code: ${error.code || 'N/A'}`);
    
    if (error.message.includes('ECONNREFUSED')) {
      console.error('\n💡 Troubleshooting:');
      console.error('   - MongoDB server is not running');
      console.error('   - Check if MongoDB is started on the expected port');
      console.error('   - Verify the connection string');
    } else if (error.message.includes('authentication')) {
      console.error('\n💡 Troubleshooting:');
      console.error('   - Check username/password in connection string');
      console.error('   - Verify authentication database');
      console.error('   - Ensure user has proper permissions');
    } else if (error.message.includes('tls') || error.message.includes('ssl')) {
      console.error('\n💡 Troubleshooting:');
      console.error('   - Check TLS/SSL configuration');
      console.error('   - Verify certificates if using custom CA');
      console.error('   - Try adding ?ssl=false to connection string for testing');
    } else if (error.message.includes('ENOTFOUND')) {
      console.error('\n💡 Troubleshooting:');
      console.error('   - Check hostname in connection string');
      console.error('   - Verify DNS resolution');
      console.error('   - Check network connectivity');
    }
    
  } finally {
    if (client) {
      await client.close();
      console.log('🔌 MongoDB connection closed');
    }
  }
}

// Run the test
testMongoDBConnection().catch(console.error);
