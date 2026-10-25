// Tiny JSON reader used to load the chase file. Read-only, no dependencies.
#pragma once
#include <string>
#include <vector>
#include <utility>
#include <cstdlib>
#include <cstring>

namespace sc
{
struct JValue
{
	enum Type
	{
		Null,
		Bool,
		Number,
		String,
		Array,
		Object
	};
	Type type     = Null;
	bool boolean  = false;
	double number = 0.0;
	std::string str;
	std::vector< JValue > arr;
	std::vector< std::pair< std::string, JValue > > obj;

	const JValue* Find( const char* key ) const
	{
		if( type != Object )
			return nullptr;
		for( const auto& kv : obj )
			if( kv.first == key )
				return &kv.second;
		return nullptr;
	}
	double NumberOr( const char* key, double fallback ) const
	{
		const JValue* v = Find( key );
		return ( v && v->type == Number ) ? v->number : fallback;
	}
	std::string StringOr( const char* key, const std::string& fallback ) const
	{
		const JValue* v = Find( key );
		return ( v && v->type == String ) ? v->str : fallback;
	}
};

class JParser
{
public:
	explicit JParser( const std::string& text ) :
		s( text.c_str() ),
		end( text.c_str() + text.size() )
	{
	}

	bool Parse( JValue& out, std::string& error )
	{
		SkipWs();
		if( !ParseValue( out, 0 ) )
		{
			error = err.empty() ? "invalid JSON" : err;
			return false;
		}
		SkipWs();
		if( s != end )
		{
			error = "trailing characters after JSON";
			return false;
		}
		return true;
	}

private:
	const char* s;
	const char* end;
	std::string err;

	void SkipWs()
	{
		while( s < end && ( *s == ' ' || *s == '\t' || *s == '\n' || *s == '\r' ) )
			++s;
	}
	bool Fail( const char* msg )
	{
		if( err.empty() )
			err = msg;
		return false;
	}
	bool Match( const char* lit )
	{
		size_t n = strlen( lit );
		if( (size_t)( end - s ) < n || strncmp( s, lit, n ) != 0 )
			return false;
		s += n;
		return true;
	}
	static void AppendUtf8( std::string& o, unsigned cp )
	{
		if( cp < 0x80 )
			o += (char)cp;
		else if( cp < 0x800 )
		{
			o += (char)( 0xC0 | ( cp >> 6 ) );
			o += (char)( 0x80 | ( cp & 0x3F ) );
		}
		else if( cp < 0x10000 )
		{
			o += (char)( 0xE0 | ( cp >> 12 ) );
			o += (char)( 0x80 | ( ( cp >> 6 ) & 0x3F ) );
			o += (char)( 0x80 | ( cp & 0x3F ) );
		}
		else
		{
			o += (char)( 0xF0 | ( cp >> 18 ) );
			o += (char)( 0x80 | ( ( cp >> 12 ) & 0x3F ) );
			o += (char)( 0x80 | ( ( cp >> 6 ) & 0x3F ) );
			o += (char)( 0x80 | ( cp & 0x3F ) );
		}
	}
	bool ReadHex4( unsigned& cp )
	{
		if( end - s < 4 )
			return Fail( "bad unicode escape" );
		cp = 0;
		for( int i = 0; i < 4; ++i )
		{
			char c = *s++;
			cp <<= 4;
			if( c >= '0' && c <= '9' )
				cp |= (unsigned)( c - '0' );
			else if( c >= 'a' && c <= 'f' )
				cp |= (unsigned)( c - 'a' + 10 );
			else if( c >= 'A' && c <= 'F' )
				cp |= (unsigned)( c - 'A' + 10 );
			else
				return Fail( "bad unicode escape" );
		}
		return true;
	}
	bool ParseString( std::string& o )
	{
		if( s >= end || *s != '"' )
			return Fail( "expected string" );
		++s;
		while( s < end && *s != '"' )
		{
			char c = *s++;
			if( c != '\\' )
			{
				o += c;
				continue;
			}
			if( s >= end )
				return Fail( "unterminated string" );
			char e = *s++;
			switch( e )
			{
			case '"': o += '"'; break;
			case '\\': o += '\\'; break;
			case '/': o += '/'; break;
			case 'b': o += '\b'; break;
			case 'f': o += '\f'; break;
			case 'n': o += '\n'; break;
			case 'r': o += '\r'; break;
			case 't': o += '\t'; break;
			case 'u':
			{
				unsigned cp;
				if( !ReadHex4( cp ) )
					return false;
				if( cp >= 0xD800 && cp <= 0xDBFF && end - s >= 6 && s[ 0 ] == '\\' && s[ 1 ] == 'u' )
				{
					s += 2;
					unsigned lo;
					if( !ReadHex4( lo ) )
						return false;
					cp = 0x10000 + ( ( cp - 0xD800 ) << 10 ) + ( lo - 0xDC00 );
				}
				AppendUtf8( o, cp );
				break;
			}
			default: return Fail( "bad escape" );
			}
		}
		if( s >= end )
			return Fail( "unterminated string" );
		++s;
		return true;
	}
	bool ParseValue( JValue& v, int depth )
	{
		if( depth > 64 )
			return Fail( "JSON nested too deeply" );
		SkipWs();
		if( s >= end )
			return Fail( "unexpected end of JSON" );
		char c = *s;
		if( c == '{' )
		{
			++s;
			v.type = JValue::Object;
			SkipWs();
			if( s < end && *s == '}' )
			{
				++s;
				return true;
			}
			for( ;; )
			{
				SkipWs();
				std::string key;
				if( !ParseString( key ) )
					return false;
				SkipWs();
				if( s >= end || *s != ':' )
					return Fail( "expected ':'" );
				++s;
				JValue child;
				if( !ParseValue( child, depth + 1 ) )
					return false;
				v.obj.emplace_back( std::move( key ), std::move( child ) );
				SkipWs();
				if( s < end && *s == ',' )
				{
					++s;
					continue;
				}
				if( s < end && *s == '}' )
				{
					++s;
					return true;
				}
				return Fail( "expected ',' or '}'" );
			}
		}
		if( c == '[' )
		{
			++s;
			v.type = JValue::Array;
			SkipWs();
			if( s < end && *s == ']' )
			{
				++s;
				return true;
			}
			for( ;; )
			{
				JValue child;
				if( !ParseValue( child, depth + 1 ) )
					return false;
				v.arr.push_back( std::move( child ) );
				SkipWs();
				if( s < end && *s == ',' )
				{
					++s;
					continue;
				}
				if( s < end && *s == ']' )
				{
					++s;
					return true;
				}
				return Fail( "expected ',' or ']'" );
			}
		}
		if( c == '"' )
		{
			v.type = JValue::String;
			return ParseString( v.str );
		}
		if( Match( "true" ) )
		{
			v.type    = JValue::Bool;
			v.boolean = true;
			return true;
		}
		if( Match( "false" ) )
		{
			v.type = JValue::Bool;
			return true;
		}
		if( Match( "null" ) )
		{
			v.type = JValue::Null;
			return true;
		}
		if( c == '-' || ( c >= '0' && c <= '9' ) )
		{
			// Parsed by hand: strtod follows the host's locale and would misread
			// "0.5" on systems that use a decimal comma.
			double sign = 1.0;
			if( *s == '-' )
			{
				sign = -1.0;
				++s;
			}
			if( s >= end || *s < '0' || *s > '9' )
				return Fail( "bad number" );
			double val = 0.0;
			while( s < end && *s >= '0' && *s <= '9' )
				val = val * 10.0 + ( *s++ - '0' );
			if( s < end && *s == '.' )
			{
				++s;
				double scale = 0.1;
				while( s < end && *s >= '0' && *s <= '9' )
				{
					val += ( *s++ - '0' ) * scale;
					scale *= 0.1;
				}
			}
			if( s < end && ( *s == 'e' || *s == 'E' ) )
			{
				++s;
				int esign = 1;
				if( s < end && ( *s == '+' || *s == '-' ) )
					esign = ( *s++ == '-' ) ? -1 : 1;
				int ex = 0;
				while( s < end && *s >= '0' && *s <= '9' )
					ex = ex * 10 + ( *s++ - '0' );
				double p = 1.0;
				for( int i = 0; i < ex && i < 400; ++i )
					p *= 10.0;
				val = esign > 0 ? val * p : val / p;
			}
			v.type   = JValue::Number;
			v.number = sign * val;
			return true;
		}
		return Fail( "unexpected character in JSON" );
	}
};

}//namespace sc
